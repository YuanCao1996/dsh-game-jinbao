import {rankedAugments,offerNames} from './augment-ranking.mjs';
import {isCompletedItem} from '../lol-companion/item-policy.mjs';
import {championKitBrief} from '../lol-companion/champion-kits.mjs';
import {lineupOf,adviceNameIssues,describeIssues} from '../dsh-coach-server/lib/advice-names.js';
import {unknownItemMentions} from '../cloud-desktop/item-name-verify.mjs';

export function trackAugmentRound(state,event,previousOwned) {
  if(event.kind==='augment_offer'){
    const id=event.roll??state.offerRound??state.augmentRounds.length+1;
    let round=state.augmentRounds.find(r=>r.id===id);
    if(!round){round={id,options:[],confirmed:[],recommended:null};state.augmentRounds.push(round);}
    round.currentOptions=offerNames(state.offers);round.options=[...new Set([...round.options,...round.currentOptions])].slice(-6);round.closed=false;round.recommended=null;round.assumed=null;round.dismissed=false;
    state.augmentRounds=state.augmentRounds.slice(-12);
  }
  if(event.kind==='augment_offer_closed'){
    const round=state.augmentRounds.find(r=>r.id===(event.roll??state.offerRound));if(round){round.closed=true;round.closedAt=Number(event.t)||Date.now();
     // The player picked a card whose name never got read; remember which position so the
     // confirmation prompt can say which one is unknown instead of only a count.
     if(Number.isInteger(event.slot)&&event.slot>=0&&event.slot<3)round.unreadSlot=event.slot;}
  }
  if(event.kind==='augment_confirmation_dismissed'){const round=state.augmentRounds.find(r=>r.id===event.roll);if(round)round.dismissed=true;}
  if(event.kind==='augment_picked'&&event.who==='self'&&event.source==='countdown-default-confirmed'){
    const round=state.augmentRounds.find(row=>row.id===event.roll);
    if(round){round.assumed=event.augment??event.name;round.confirmationSource=event.source;round.recommended=null;}
  }
  // 迟到的公告可以纠正 OCR 读错的卡名：实测「邦！」被读成「杀戮时间到了」，像素判定是对的、
  // 名字错了。规则：高置信度自己的公告、落在该轮关闭后 90 秒内、且名字在该轮候选里出现过
  // （或该轮有未读出的槽位），才替换该轮的记录。
  if(event.kind==='augment_mutate'&&event.who==='self'&&event.confidence==='high'){
    const announced=event.augment??event.name, at=Number(event.t)||Date.now();
    if(announced){
      const round=[...state.augmentRounds].reverse().find(r=>r.closed&&r.closedAt&&at-r.closedAt>=0&&at-r.closedAt<=90000
        &&((r.confirmed.length===1&&r.confirmed[0]!==announced)||r.confirmed.length===0)
        &&(r.options.includes(announced)||r.unreadSlot!==undefined));
      if(round){
        // 只把错的名字摘掉，正确名字交给下面的既有逻辑入库（否则会重复添加）。
        // 视觉没判出来的轮次（confirmed 为空）也能靠公告补齐：这是确定信号，
        // 比让玩家自己点确认更好。有旧值时才需要摘掉错名字。
        const stale=round.confirmed[0];
        if(stale){const at2=state.ownedAugments.indexOf(stale);if(at2>=0)state.ownedAugments.splice(at2,1);}
        round.confirmed=[announced];
        round.correctionAt=at;
        if(stale)round.correctedFrom=stale;
      }
    }
  }
  const added=state.ownedAugments.filter(n=>!previousOwned.includes(n));
  if(added.length){
    const rounds=[...state.augmentRounds].reverse();
    // A late announcement from an earlier round must not confirm the panel that is open now:
  // that would suppress its confirmation dialog and attach the wrong augment to the round.
  // The last fallback only covers rounds whose options were never read.
  const round=state.augmentRounds.find(r=>r.id===event.roll)
   ??rounds.find(r=>!r.confirmed.length&&added.some(n=>r.options.includes(n)))
   ??rounds.find(r=>!r.confirmed.length&&!r.options.length);
    if(round){round.confirmed.push(...added);round.confirmationSource=event.source??'log-confirmed';round.assumed=null;round.recommended=null;}
  }
  const exact=state.augmentRounds.find(round=>round.id===event.roll);
  if(exact&&event.who==='self'&&event.confirmationId)exact.confirmationId=event.confirmationId;
  if(exact&&event.who==='self'&&exact.confirmed.includes(event.augment??event.name)&&event.source&&event.source!=='countdown-default-confirmed')exact.confirmationSource=event.source;
}

export function updateAugmentRecommendations(state,rows=[]){
  const ranked=rankedAugments(rows,state.me.champion);
  for(const round of state.augmentRounds){
    if(round.confirmed.length||round.assumed)continue;
    const best=ranked.find(row=>(round.currentOptions??round.options).includes(row.name)&&Number(row.rank)>0&&Number.isFinite(Number(row.rank)));
    if(best)round.recommended=best.name;
  }
}
const ownFacts=facts=>JSON.stringify([facts.hero,facts.currentItems.filter(isCompletedItem),facts.confirmedAugments,facts.assumedAugments]);
const decisionKey=(state,facts)=>JSON.stringify([state.game,state.match,state.matchStartedAt,ownFacts(facts),facts.enemies.map(e=>[e.hero,e.items.filter(isCompletedItem),e.augments]),facts.unassignedEnemyItems.filter(isCompletedItem)]);
const items=value=>(Array.isArray(value)?value:[]).map(i=>({name:typeof i==='string'?i:i?.name,count:i?.count??1,...(i?.id!=null?{id:i.id}:{}),...(typeof i?.completed==='boolean'?{completed:i.completed}:{})})).filter(i=>i.name);
function playerFacts(player, side, augmentRows){
  const kit=championKitBrief(player?.champion,{skills:4,desc:70});
  return {
    side,
    hero:player?.champion??'',
    roles:Array.isArray(player?.roles)&&player.roles.length?player.roles:(kit?.roles??[]),
    summonerSpells:Array.isArray(player?.spells)?player.spells.slice(0,2):[],
    skills:kit?.spells??[],
    items:items(player?.items),
    augments:(augmentRows??[]).filter(row=>row.side===side).map(row=>({hero:row.hero,augment:row.augment,confirmed:row.confirmed!==false,source:row.source??'',effect:String(row.effect??'').slice(0,120)})),
  };
}
export function equipmentContext(state){
  const augmentRows=Array.isArray(state.augmentSelections)?state.augmentSelections:[];
  return {hero:state.me.champion,mode:state.mode,currentItems:items(state.me.items),
    self:playerFacts(state.me,'self',augmentRows),
    allies:state.allies.map(p=>playerFacts(p,'ally',augmentRows)),
    enemies:state.enemies.map(p=>playerFacts(p,'enemy',augmentRows)),
    enemyAugments:augmentRows.filter(row=>row.side==='enemy').map(row=>({hero:row.hero,augment:row.augment,confirmed:row.confirmed!==false,source:row.source??'',effect:String(row.effect??'').slice(0,120)})),
    unassignedEnemyItems:state.enemies.some(p=>items(p.items).length)?[]:items(state.enemyItems),
    confirmedAugments:[...state.ownedAugments],
    assumedAugments:state.augmentRounds.filter(r=>!r.confirmed.length&&(r.assumed||r.recommended)&&!state.ownedAugments.includes(r.assumed||r.recommended))
      .map(r=>({round:r.id,name:r.assumed||r.recommended,reason:r.assumed?'倒计时默认推测，尚未经本人确认':'未确认选择，按本轮当前候选中英雄适配排名最高项推测'}))};
}

function equipmentAdviceProblem(state,text){
 try{
  const issues=adviceNameIssues(text,lineupOf(state));
  if(issues.unknown.length||issues.aliased.length)return 'champion:'+describeIssues(issues);
 }catch{}
 const rows=[...(state?.me?.items??[]),...(state?.allies??[]).flatMap(player=>player?.items??[]),...(state?.enemies??[]).flatMap(player=>player?.items??[])];
 const names=rows.map(item=>typeof item==='string'?item:String(item?.name??'')).filter(Boolean);
 const itemProblem=unknownItemMentions(text,names);
 return itemProblem?'item:'+itemProblem:'';
}

export function createEquipmentCoach({getState,agentChat,save,onAdvice=()=>{},canRequest=()=>true,now=Date.now,debounceMs=2000,cooldownMs=30000,openingRetryMs=15000}){
  let pending='',since=0,lastAt=-Infinity,lastDone='',busy=false,closed=false,retryAt=0,lastConfirmed='',failures=0,lastAttemptAt=0;
   // 对局是否还活着要看游戏时间有没有推进：state.at 只要采集器还在写快照就是新鲜的，
   // 实测对局结束后 at 仍每分钟更新、gameSeconds 却冻在 08:19。
   let lastClock=null,lastClockAt=0;
  // 阵亡与开局都是"一次性事件"，不是"事实又变了"：它们各自只发一次，不走购买那次
  // 的防抖与冷却，否则玩家阵亡时正好撞上冷却就永远收不到提醒。
  let lastMatch='',opening={match:'',done:false,retryAt:0};
  const backoffMs=()=>Math.min(60000,5000*2**Math.min(4,Math.max(0,failures-1)));
const oneShot=(reason,question,{onSuccess=()=>{},onFailure=()=>{}}={})=>{
   busy=true;lastAttemptAt=now();const current=getState(),match=current.match,started=current.matchStartedAt;
   void agentChat({game:current.game,match,question,topic:'equipment',automatic:true}).then(async answer=>{
 failures=0;
    const now= getState();if(closed||now.ended||now.match!==match||now.matchStartedAt!==started)return;
    if(typeof answer!=='string'||!answer.trim())return;const text=answer.trim().slice(0,4000);
    const problem=equipmentAdviceProblem(now,text);
    if(problem){now.equipmentStatus='建议含未确认名称，已拦截';onFailure();return;}
    if(reason==='opening')now.openingBuild=text;
    await onAdvice(now,text,reason);await save();onSuccess();
   }).catch(()=>{failures+=1;lastAt=now();lastAttemptAt=now();retryAt=Math.max(retryAt,now()+backoffMs());opening.retryAt=Math.max(opening.retryAt,now()+Math.max(openingRetryMs,backoffMs()));onFailure();}).finally(()=>{busy=false;});
  };
  return {
    tick(){
      const state=getState();
      const clockNow=now();
      if(state.gameSeconds!==lastClock){lastClock=state.gameSeconds;lastClockAt=clockNow;}
      if(Number.isFinite(state.gameSeconds)&&clockNow-lastClockAt>120000)return;
      if(closed||typeof agentChat!=='function'||!state.match||!state.me.champion||state.ended||state.phase==='ChampSelect'||now()-state.at>30000)return;
      if(state.match!==lastMatch){lastMatch=state.match;opening={match:state.match,done:false,retryAt:0};}
      // 开局加载完成、双方阵容都拿到了，给一份六件完整装备规划（每局一次）。
      // 大乱斗的加载阶段有时还看不到双方阵容，所以"刚进游戏且一件成装都没有"也算开局。
      const openingWindow=state.phase==='Loading'||(state.phase==='InProgress'&&!items(state.me.items).some(isCompletedItem));
      // A failed opening turn used to consume the one shot, so a busy or preempted model left the
      // player without the plan for the whole match. Keep retrying until it lands.
      if(!opening.done&&openingWindow&&state.allies.length&&state.enemies.length&&!busy&&canRequest()&&state.me.champion&&now()>=opening.retryAt){
       opening.retryAt=now()+openingRetryMs;
       oneShot('opening','【开局出装规划】对局加载完成，双方阵容已确定。必须参考 facts.enemies 中敌方五人的英雄、定位、技能、成装，以及 facts.enemyAugments 中已有 OCR/聊天记录的海克斯；没有记录就写未知，不编造。请给出本局六件完整装备的购买顺序（含鞋子与关键小件），并说明针对敌方谁的哪个威胁、如何配合自己已选强化。现在是开局，不要假设已有任何成装。播报不要只写“下一件买X”，用“X 搭配你选择的 A 海克斯可发挥…/X 可针对敌方 Y 的…”句式；末尾附六件顺序。控制在300字内。\n【对局事实 JSON】\n'+JSON.stringify(equipmentContext(state)),{onSuccess:()=>{opening.done=true;}});
      }
      const facts=equipmentContext(state);
  const ownCompleted=(Array.isArray(state.me?.items)?state.me.items:[]).filter(isCompletedItem);
  const fullBuild=ownCompleted.length>=6;
      if(!facts.currentItems.length&&!facts.enemies.some(e=>e.items.length)&&!facts.unassignedEnemyItems.length&&!facts.confirmedAugments.length&&!facts.assumedAugments.length)return;
      const key=decisionKey(state,facts);
      if(key!==pending){pending=key;since=now();state.equipmentStatus=lastDone?'正在结合最新装备与海克斯更新建议…':'正在生成出装建议…';}
      // A confirmation changes the build inputs, so it must not wait for the cooldown or the
      // voice queue. The first turn has no baseline yet and keeps the previous behaviour.
      const confirmedKey=JSON.stringify(facts.confirmedAugments),urgent=lastConfirmed!==''&&confirmedKey!==lastConfirmed;
      if(busy||key===lastDone||now()<retryAt||(!urgent&&(now()-since<debounceMs||now()-lastAt<cooldownMs)))return;
      if(!canRequest()&&!urgent){state.equipmentStatus=lastDone?'低频更新中，已有出装建议仍可参考':'等待低频自动分析';return;}
      busy=true;lastAt=now();lastAttemptAt=now();
      const match=state.match,started=state.matchStartedAt;
      let question='【自动出装建议任务】请结合当前装备、facts.enemies 中敌方五人的英雄定位、技能、成装和已记录海克斯，以及自己所有已确认海克斯和下列明确标注为推测的强化，更新出装建议。优先说明装备与已选海克斯的联动，或针对敌方某英雄的克制理由；不要只报“下一件买X”。推测强化必须写成“暂按…考虑，待确认”，不得宣称已拥有；所有已确认强化都要参与取舍。没有可信排名时不要编造推测。播报不要提散件/组件装备，只讲成装，也不要播报购买散件；如果有成装已经拥有散件，不要重复提醒合成这件成装，直接讲下一件成装。不要重复列出敌方装备明细或购买事件。敌方海克斯只使用 facts 中已有的 OCR/聊天记录；没有记录就写未知，不得编造敌方已选。玩法与装备数值不确定时调用工具查证。最后必须附一行「六件顺序：1 名称 2 名称 3 名称 4 名称 5 名称 6 名称」，只列成装；海克斯会改变取舍时要按当前已确认海克斯和敌方阵容调整。播报句式优先使用“X 搭配你选择的 A 海克斯可发挥…效果”或“X 可针对敌方 Y 的…”，并点名依据。只用 coach_reply 提交不超过600字的最终建议。\n【装备决策事实 JSON】\n'+JSON.stringify(facts);
  if(fullBuild)question='【满装替换评估】当前已经买满六件成装。不要建议新增装备；只有确实需要替换时才说明：换掉哪一件、换成什么、为什么。若当前六件就是最优，只回复四个字：无需换装。不要提散件/组件。\n【对局事实 JSON】\n'+JSON.stringify({hero:state.me.champion,currentItems:ownCompleted,enemies:facts.enemies,confirmedAugments:facts.confirmedAugments,assumedAugments:facts.assumedAugments});
      void agentChat({game:state.game,match,question,topic:'equipment',automatic:true,...(urgent?{urgent:true}:{})}).then(async answer=>{
 failures=0;
        const current=getState();
        if(closed||current.ended||current.match!==match||current.matchStartedAt!==started||current.game!==state.game||ownFacts(equipmentContext(current))!==ownFacts(facts))return;
        if(typeof answer==='string'&&answer.trim()){
  const problem=equipmentAdviceProblem(current,answer.trim());
  if(problem){current.equipmentStatus='建议含未确认名称，已拦截';return;}
   if(fullBuild&&/无需换装|不需要换装|不用换装|保持.{0,4}六件|没有.{0,4}替换/.test(answer)){current.equipmentStatus='六件成装，暂不换装';return;}
   if(fullBuild)await onAdvice(current,answer.trim().slice(0,4000),'purchase');
   current.equipment=answer.trim().slice(0,4000);current.equipmentAssumptions=facts.assumedAugments;current.equipmentStatus=decisionKey(current,equipmentContext(current))===key?'':'敌方装备已变化，稍后更新建议';lastDone=key;lastConfirmed=confirmedKey;if(!current.equipmentStatus)await onAdvice(current,current.equipment);await save();}
      }).catch(error=>{
        const current=getState();
        if(error?.code==='auto_deferred'){lastAt=-Infinity;retryAt=Math.max(now()+3000,Number(error.retryAt)||0);if(!closed&&current.match===match&&!current.ended)current.equipmentStatus='等待低频自动分析';return;}
        if(!closed&&!current.ended&&current.match===match&&current.matchStartedAt===started){failures+=1;lastAt=now();retryAt=Math.max(retryAt,now()+backoffMs());const interrupted=error?.code==='agent_preempted';if(interrupted){lastAt=-Infinity;retryAt=now()+1000;}if(decisionKey(current,equipmentContext(current))===key)current.equipmentStatus=interrupted?'已优先处理手动请求，稍后继续生成出装建议':'出装建议暂未生成，稍后自动重试';}
      }).finally(()=>{busy=false;});
    },
    close(){closed=true;},
    invalidate(){lastAt=-Infinity;},
  };
}
