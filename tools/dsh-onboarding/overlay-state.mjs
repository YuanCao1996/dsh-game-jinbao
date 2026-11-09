import { condenseAdvice, stripSources } from '../cloud-desktop/advice-text.mjs';
import { hextechLeaderboardPage, heroLeaderboardPage, topRuneId, leaderboardRowData } from './leaderboard-pages.mjs';
import { mkdir, readdir, stat, open, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WZRY_ADAPTER } from '../dsh-coach-server/lib/adapters/wzry.js';
import { projectWzryFacts } from '../dsh-coach-server/lib/adapters/wzry-facts.js';
import { createMatchTracker } from '../dsh-coach-server/lib/match-tracker.js';
import { rankedAugments, augmentLine, offerNames } from './augment-ranking.mjs';
import { TIEBREAK_QUESTION, tiebreakPick } from './vision-tiebreak.mjs';
import { projectProgressEvent,observeEquipment,addProgressEvent } from './progress-events.mjs';
import { createGameMemory } from '../dsh-coach-server/lib/game-memory.js';
import { normalizeLolMode } from '../dsh-coach-server/lib/game-mode-prompt.js';
import {trackAugmentRound,updateAugmentRecommendations,createEquipmentCoach} from './equipment-context.mjs';
import {augmentConfirmation,acceptedTeamRound} from './augment-confirmation.mjs';
import {teamStrength,TEAM_STRENGTH_NOTE,liveTeamEstimate,LIVE_ESTIMATE_NOTE} from './team-strength.mjs';
import {chatFailureMessage} from './chat-errors.mjs';
import {suggestOverlayQuestion} from './chat-suggestion.mjs';
import {adviceIsValid,createAdviceValidity} from '../dsh-coach-server/lib/lol-coaching-plan.js';
import {eventWindow} from '../dsh-coach-server/lib/event-window.mjs';
import {createCompanion} from '../dsh-coach-server/lib/companion.mjs';
import {whoKilled,recordMultikill,settlePraise,PRAISE_ROLES,killInfoFromEvents} from './multikill-praise.mjs';
import {champSelectPartnerText} from '../lol-companion/partner-index.mjs';
import {createKnowledgeSearch} from './knowledge-search.mjs';
import {isCompletedItem} from '../lol-companion/item-policy.mjs';

const text = value => typeof value === 'string' ? value.slice(0, 4000) : '';
const list = value => Array.isArray(value) ? value : [];
// Older LoL recordings list the four teammates separately from the local hero.
// Current live snapshots already include all five; keep their order untouched.
const observedAllies=(players,me)=>{
  const containsSelf=players.some(p=>['puuid','riotId','championAlias','championId','champion'].some(key=>me?.[key]!=null&&me[key]!==''&&p[key]===me[key]));
  return players.length===4&&me?.champion&&!containsSelf?[me,...players]:players;
};
const keyEventLabels = {
  GameStart:'对局开始',GameEnd:'对局结束',Ace:'团灭',TurretKilled:'防御塔被摧毁',
  InhibKilled:'水晶被摧毁',InhibRespawningSoon:'水晶即将重生',InhibRespawned:'水晶已重生',
  DragonKill:'小龙被击败',BaronKill:'大龙被击败',HeraldKill:'峡谷先锋被击败',
};
export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '等待对局';
  const n = Math.floor(seconds);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}
export function initialOverlayState() {
  return { game: null, mode: '', match: null, at: 0, selfIdentityAt: 0, matchStartedAt: 0, gameSeconds: null, ended: false, phase: '',observedMatch:false,
    me: {}, allies: [], enemies: [], bench: [], playerStats: [], enemyItems: [], events: [], equipmentSnapshots:new Map(),
    ownedAugments: [], revealedAugments: [], augmentRounds: [], offers: [], offerRound: null, offerHistory: [], augmentCaptureAvailable: null, augmentCaptureReason: '', equipment: '', equipmentStatus:'', equipmentAssumptions: [], augmentAdvice: '', teamfight: '', broadcasts: [], chat: [],
    agentStatus:'', agentError:'', coachStatus:null, praiseChains:{}, notices:[], noticeWinRate:null };
}
// Pure projection shared by live polling and log replay tests. Epoch time only orders
// records; the displayed clock always comes from the game's elapsed seconds.
export function applyOverlayEvent(state, event, file, {continueStart=false}={}) {
 // 识别盲区是诊断事件，不进入事件页，但它是经验提炼要用的真事实，这里自己计数。
 if(event&&event.kind==='augment_capture_blind'){state.captureBlind=(Number(state.captureBlind)||0)+1;return state;}
  if (!event || typeof event !== 'object') return;
  const at = eventTimestamp(event);
  if (event.broadcast) {
    if(at<state.matchStartedAt||(event.game&&state.game&&event.game!==state.game)||(event.match&&event.match!==state.match))return;
    const reply = { at, text: text(event.broadcast), validity:event.validity ?? null,priority:Number.isInteger(event.priority)?Math.max(0,Math.min(2,event.priority)):0,dimension:typeof event.dimension==='string'?event.dimension:'',stage:typeof event.key==='string'?event.key:'' };
    // 云端多杀点评：同一个 praiseChain 只留一条播报。云端先到就直接落一条；
    // 本地兜底先到就只替换文案并保留原来的 at，避免同一波连杀被播两遍。
    if (typeof event.praiseChain === 'string' && event.praiseChain) {
      const chainKey = Object.keys(state.praiseChains ?? {}).find(key => key + '@' + state.praiseChains[key]?.chainAt === event.praiseChain);
      if (!chainKey) return; // 链已随新对局清空，旧的云端点评不再上屏
      state.praiseChains[chainKey].cloudFilled = true;
      const existing = state.broadcasts.find(r => r.praiseChain === event.praiseChain);
      if (existing) {
        existing.text = reply.text; existing.priority = 2;
        existing.expiresAt = Math.max(Number(existing.expiresAt) || 0, at + 12000);
      } else {
        state.broadcasts.push({ ...reply, priority: 2, praise: true, praiseChain: event.praiseChain, expiresAt: at + 12000 });
        state.broadcasts.sort((a, b) => a.at - b.at);
        state.broadcasts = state.broadcasts.slice(-12);
      }
      return;
    }
    if (!state.broadcasts.some(r => r.at === at && r.text === reply.text)) {
      state.broadcasts.push(reply); state.broadcasts.sort((a, b) => a.at - b.at);
      state.broadcasts = state.broadcasts.slice(-12);
    }
    if(event.key==='postAugment')state.augmentPlaybook={text:reply.text,at,gameSeconds:state.gameSeconds,owned:JSON.stringify([...state.ownedAugments].sort())};
    return;
  }
  if (!event.game || at < state.at) return;
  const match = event.match ?? file;
  if(!state.match){state.match=match;state.matchStartedAt=at;state.game=event.game;}
  if (((event.kind === 'game_start' || event.kind === 'match_start')&&!continueStart) || (event.kind==='state' && state.match !== match)) {
    Object.assign(state, initialOverlayState(), { match, matchStartedAt:at, game: event.game });
  }
  state.at = at;
  state.game = event.game;
  // Unrelated events must not make a previously observed hero appear fresh.
  if (state.game === 'lol' && ['game_start', 'state'].includes(event.kind)) {
    const champion = event.kind === 'state' ? (event.state?.champion ?? event.me?.champion) : event.me?.champion;
    if (typeof champion === 'string' && champion.trim()) state.selfIdentityAt = at;
  }
  if(state.game==='lol'&&['load','loading_roster'].includes(event.kind)){
    state.me={...state.me,...event.me};
    if(Array.isArray(event.allies))state.allies=observedAllies(event.allies,state.me);
    if(Array.isArray(event.enemies))state.enemies=event.enemies;
    if(!(state.gameSeconds>0)&&!['InProgress','Reconnect'].includes(state.phase))state.phase='Loading';
    observeEquipment(state);
  }
  if(event.kind==='ally_ultimate'){
    const ally=state.allies.find(p=>p.championAlias===event.championAlias&&p.championAlias!==state.me.championAlias);
    if(!ally||event.source!=='hud-indicator'||!Number.isFinite(event.capturedAt)||Math.abs(at-event.capturedAt)>4000)return;
    for(const reply of state.broadcasts)if(reply.allyUltimate===event.championAlias)reply.revoked=true;
    if(event.ready===true&&event.notify===true&&ally.dead===false){
      const message=`画面观察：队友${ally.champion}大招可用，可留意配合窗口。`;
      state.broadcasts.push({at,text:message,priority:1,allyUltimate:event.championAlias,expiresAt:event.capturedAt+4000});
      state.broadcasts=state.broadcasts.slice(-12);
      addProgressEvent(state,'ally-r:'+event.championAlias+':'+event.capturedAt,message,event.gameTime,'ally-ultimate');
    }
    return;
  }
  if(event.kind==='champ_select'){
    if(state.match!==match||state.phase!=='ChampSelect')Object.assign(state,initialOverlayState(),{match,matchStartedAt:at,game:event.game,at});
    state.phase='ChampSelect';state.me=event.me??{};state.allies=list(event.allies);state.enemies=list(event.enemies);state.bench=list(event.bench);state.gameSeconds=null;
  }
  const mode=normalizeLolMode(event.mode??event.queue??event.state?.mode);
  if(state.game==='lol'&&mode)state.mode=mode;
  if(event.kind==='chat_events'){
  // 游戏内聊天框 OCR 到的公告：目前是「某人买入了某件装备」，逐条并进事件流。
  for(const item of list(event.events)){
   if(!item||item.kind!=='purchase')continue;
   const who=String(item.champion??'').trim();
   const what=String(item.item??item.itemRaw??'').trim();
   if(!what)continue;
   const key='purchase:'+[who,what,Number(item.time)||0].join('|');
   if(state.events.some(entry=>entry.key===key))continue;
   state.events.push({key,time:Number.isFinite(Number(item.time))?clock(Number(item.time)):clock(state.gameSeconds),text:'装备更新：'+(who?who+' · ':'')+'买入 '+what,kind:'purchase'});
  }
  state.events=state.events.slice(-200);
 }
 if(event.kind==='champ_select_end'){
    state.ended=event.cancelled===true;state.phase=event.cancelled?'Lobby':'Loading';
    if(event.cancelled){state.me={};state.allies=[];state.enemies=[];state.bench=[];}
  }
  if (event.kind === 'phase') { state.phase = text(event.phase); if(event.phase==='EndOfGame')state.ended=true; }
  if (event.kind === 'game_start') {
    state.gameSeconds = Number.isFinite(event.gameTime) ? event.gameTime : state.gameSeconds;
    state.me = {...state.me,...event.me};
    if(state.game==='generic'){state.me.genericState=event.genericState;state.phase=event.phase==='InProgress'?'InProgress':'Observing';}
    if(Array.isArray(event.allies))state.allies=state.game==='lol'?observedAllies(event.allies,state.me):event.allies;
    if(Array.isArray(event.enemies))state.enemies=event.enemies;
    observeEquipment(state);
  }
  if (event.kind === 'state') {
    const s = event.state ?? {};
    state.me = { ...state.me, ...event.me, ...s };
    if(state.game==='generic'&&['Observing','InProgress'].includes(event.phase))state.phase=event.phase;
    if (Number.isFinite(s.time)) {state.gameSeconds = s.time;if(state.game==='lol'&&s.time>0&&!state.ended)state.phase='InProgress';}
    const allies=Array.isArray(event.allies)?event.allies:state.game==='lol'&&Array.isArray(s.allyPlayers)?s.allyPlayers:null;
    const enemies=Array.isArray(event.enemies)?event.enemies:state.game==='lol'&&Array.isArray(s.enemyPlayers)?s.enemyPlayers:null;
    if(allies)state.allies=state.game==='lol'?observedAllies(allies,state.me):allies;
    if(enemies)state.enemies=enemies;
    state.enemyItems = list(s.enemyItems);
    state.equipment = text(s.build) || state.equipment;
    state.teamfight = text(s.teamfight?.text) || state.teamfight;
    observeEquipment(state);
  }
  if (event.kind === 'player_stats') state.playerStats = list(event.rows);
  if (event.kind === 'augment_offer') {
    if((event.roll!=null&&event.roll!==state.offerRound)||!state.offers.length)state.offerHistory=[];
    state.offerRound=event.roll??state.offerRound;
    state.offers=list(event.options??event.cards??event.augments).slice(0,3);
    state.offerHistory=[...new Set([...state.offerHistory,...offerNames(state.offers)])].slice(0,6);
    // 同一轮里还有重掷：如果刚识别到的「已选」这张已经不在新候选里，说明那次是提前触发
    // （玩家其实又刷新了），撤掉这条记录与对应消息，避免错报已选海克斯。
    const lastPick=state.lastPick??null;
    const freshPick=!!lastPick&&Date.now()-Number(lastPick.at??0)<20000;
    const rolled=offerNames(state.offers);
    if(freshPick&&rolled.length&&!rolled.includes(lastPick.name)){
      state.ownedAugments=state.ownedAugments.filter(name=>name!==lastPick.name);
      state.notices=(state.notices??[]).filter(n=>n.key!=='aug-picked:'+lastPick.name);
      // 视觉认错又没把握时别猜：标记成待确认，等 trackAugmentRound 跑完再收尾
      // （它会因为新候选把这一轮重新置为打开状态，所以标记必须延后处理）。
      state.uncertainPick={roll:lastPick.roll??null,name:lastPick.name,at:Date.now()};
      state.lastPick=null;
    }
  }
  if (event.kind === 'augment_offer_closed') state.offers=[];
  if (event.kind === 'augment_capture_status') { state.augmentCaptureAvailable=event.available===true; state.augmentCaptureReason=text(event.reason); }
  if(event.kind==='augment_picked'&&event.source==='team-user-confirmed'&&Array.isArray(event.replaces)){
    const round=state.augmentRounds.find(row=>row.id===event.roll),name=event.augment??event.name;
    if(round?.confirmationSource==='countdown-default-confirmed'&&round.options.includes(name)){
      const removed=round.confirmed.filter(value=>event.replaces.includes(value));
      state.ownedAugments=state.ownedAugments.filter(value=>!removed.includes(value)||state.augmentRounds.some(other=>other!==round&&other.confirmed.includes(value)));
      round.confirmed=round.confirmed.filter(value=>!removed.includes(value));
    }
  }
  const previousOwned=[...state.ownedAugments];
  projectProgressEvent(state,event);
  trackAugmentRound(state,event,previousOwned);
  // 待确认收尾：跑完 trackAugmentRound 之后再把那一轮置为已关闭且未确认，
  // 悬浮窗据此弹出确认面板（选项按适配排名排序，第一名标「优先推荐」）。
  if(state.uncertainPick){
    const pending=state.uncertainPick;state.uncertainPick=null;
    const round=(state.augmentRounds??[]).find(r=>(pending.roll==null||r.id===pending.roll))??(state.augmentRounds??[]).at(-1);
    if(round){
      round.confirmed=(round.confirmed??[]).filter(name=>name!==pending.name);
      round.closed=true;
      round.closedAt=Date.now();
      round.dismissed=false;
    }
  }
  // 记下最近一次识别到的已选：重掷撤回时用这个状态判断，不再依赖消息卡片是否已生成。
  {
    const added=state.ownedAugments.filter(name=>!previousOwned.includes(name));
    if(added.length)state.lastPick={name:added.at(-1),roll:event.roll??state.offerRound??null,at:Date.now()};
  }
  if (event.kind === 'event') {
    const seconds = Number(event.time ?? event.EventTime);
    const name = event.name ?? event.EventName;
    if (name === 'GameEnd') state.ended = true;
    // Own multi-kills (and an ally's quadra/penta) are praised locally from the game
    // event time, so an escalating chain settles into one praise at its real level.
    if (name === 'Multikill') {
      const killed = whoKilled(state, event);
      if (killed.side !== 'other') {
        // 带上“这波杀了谁”，以及其中此前杀过我的敌人（复仇播报用）。
    const killInfo=(killed.side==='self')?killInfoFromEvents({
      events:(state.events??[]).map(e=>({name:e.kind==='kill'?'ChampionKill':(e.name??''),killer:e.killer,victim:e.victim,at:e.at})),
      me:state.me?.champion??'',
      // 本局杀过我的敌人：从事件里的“我被击杀”反推，无需额外状态字段。
      killedMeBefore:(()=>{
       const mine=String(state.me?.champion??'').trim();
       if(!mine)return [];
       const who=[];
       for(const e of (state.events??[])){
        const kind=String(e?.kind??'');
        const victim=String(e?.victim??'');
        const killer=String(e?.killer??'');
        if(!victim||!killer)continue;
        if(kind!=='kill'&&kind!=='death'&&kind!=='ChampionKill')continue;
        if(victim.includes(mine)||mine.includes(victim)){if(!who.includes(killer))who.push(killer);}
       }
       return who.slice(0,5);
      })(), now:at }):{victims:[],revenge:[]};
    recordMultikill(state, { streak: event.KillStreak ?? event.killStreak, side: killed.side, hero: killed.hero, at, now: at,
     victims:killInfo.victims, revenge:killInfo.revenge });
      }
    }
    // 击杀类也进事件流：以前只收塔/龙/水晶/团灭，玩家看不到「谁杀了谁」。
    // 只记与我方有关的，避免每次团灭刷十几条。
    if(name==='Multikill'){
      const streak=Number(event.KillStreak??event.killStreak)||0;
      const killer=String(event.killer??'');
      const mine=String(state.me?.champion??'').trim();
      if(streak>=3&&killer&&mine){
        const allies=list(state.allies).map(person=>String(person?.champion??'')).filter(Boolean);
        if(killer.includes(mine)||allies.some(hero=>hero&&killer.includes(hero))){
          const key='Multikill:'+String(event.id??event.EventID??streak+':'+seconds);
          if(!state.events.some(entry=>entry.key===key))state.events.push({key,time:clock(seconds),text:`${killer} ${streak}杀`,kind:'Multikill'});
        }
      }
    }
    if(name==='ChampionKill'&&String(event.victim??event.VictimName??'').includes(String(state.me?.champion??'\u0000'))){
      const key='Death:'+String(event.id??event.EventID??seconds);
      if(!state.events.some(entry=>entry.key===key))state.events.push({key,time:clock(seconds),text:'你被击杀',kind:'Death'});
    }
    const label=Object.hasOwn(keyEventLabels,name)?keyEventLabels[name]:null;
    if(label){      const id=event.id??event.EventID;
      const key=Number.isInteger(id)?name+':'+id:JSON.stringify([name,seconds,event.turret??event.TurretKilled,event.InhibKilled??event.InhibitorKilled]);
      if(!state.events.some(e=>e.key===key)){
        const result=name==='GameEnd'?(event.Result==='Win'?'胜利':event.Result==='Lose'?'失败':null):null;
        state.events.push({key,time:clock(seconds),text:label+(result?' · '+result:''),kind:name});
        // 与 progress-events 保持一致：关键事件也不该被 40 条上限挤掉。
        state.events=state.events.slice(-200);
      }
    }
  }
  if (event.kind === 'brief' && event.text) {
    const m = event.text.match(/(\d{1,3}):(\d{2})/);
    if (m) state.gameSeconds = Number(m[1]) * 60 + Number(m[2]);
  }
}
export function eventTimestamp(event) {
  return Number(event.t) || Number(event.at) || Date.parse(event.at) || Date.parse(event.timestamp) || 0;
}

export function createOverlayRouter(limit = 64) {
  const states = new Map(), tracker = createMatchTracker(limit);
  let active = initialOverlayState();
  return {
    state: () => active,
    apply(raw, file) {
      if(raw?.clockPending)return;
      let event = raw;
      if(raw?.game==='wzry'&&typeof raw.message==='string') {
        const facts=projectWzryFacts(WZRY_ADAPTER.log.classify(raw));
        if(!facts)return;
        event={...raw,...facts,t:eventTimestamp(raw)};
      }
      if(!event||typeof event!=='object')return;
      if(event.matchEnded&&!(event.kind==='event'&&event.name==='GameEnd'))return;
      if(event.broadcast){
        const requested=typeof event.match==='string'?event.match.replace(/^file-/,''):null;
        const legacy=event.match?.startsWith('file-')?[...states.values()].find(state=>state.game===event.game&&state.match?.endsWith('#1')&&state.source?.replace(/\.jsonl$/i,'')===requested):null;
        const target=requested?states.get(event.game+':'+requested)??legacy:event.source
          ? [...states.values()].filter(state=>state.game===event.game&&state.source===event.source).at(-1)
          : active;
        if(target)applyOverlayEvent(target,{...event,...(requested?{match:target.match}:{})},file);
        return target;
      }
      if(!['lol','wzry','generic'].includes(event.game))return;
      const at=eventTimestamp(event);
      const identity=tracker.identify(event.game,file,{seconds:event.state?.time??event.gameTime,at,
        started:event.kind==='game_start'||event.kind==='match_start',ended:event.kind==='event'&&event.name==='GameEnd',match:event.match});
      if(identity.pending)return;
      const key=event.game+':'+identity.match;
      let state=states.get(key);
      if(!state){
        state=initialOverlayState();
        if(states.size>=limit){const removable=[...states].find(([,candidate])=>candidate!==active);if(removable)states.delete(removable[0]);}
        states.set(key,state);
      }
      const continueStart=event.game==='lol'&&event.kind==='game_start'&&!event.match&&!identity.boundary&&state.match===identity.match&&!state.ended;
      applyOverlayEvent(state,{...event,match:identity.match},file,{continueStart});
      state.source=file;
      const isMatch=['state','game_start','match_start','champ_select','load','loading_roster'].includes(event.kind);
      if(isMatch)state.observedMatch=true;
      if(isMatch&&(!active.match||active===state||active.ended||(active.game==='generic'&&['lol','wzry'].includes(event.game)&&at>=active.at)||
          (at>=active.at&&(event.game===active.game||at-active.at>=30000))))active=state;
      if(active.ended&&event.kind!=='champ_select_end'){
        const next=[...states.values()].filter(candidate=>candidate!==active&&!candidate.ended&&candidate.observedMatch&&candidate.match&&at-candidate.at<30000)
          .sort((a,b)=>b.at-a.at)[0];
        if(next)active=next;
      }
      return state;
    },
  };
}
const percent = v => Number.isFinite(Number(v)) && v !== null ? Number(v) + '%' : '暂无数据';
function items(value) {
  if (typeof value === 'string') {
    try { return items(JSON.parse(value)); } catch { return value.slice(0, 700); }
  }
  return list(value).map(i => typeof i === 'string' ? i : i?.name ?? i?.champion ?? '').filter(Boolean).join('、');
}
const normalizeHero=value=>String(value??'').replace(/[\s·・]/g,'').toLowerCase();
function heroStatMatches(row,champion){
 const target=normalizeHero(champion);
 return !!target&&[row.name,row.title,row.champion].some(value=>{const hero=normalizeHero(value);return !!hero&&(hero===target||target.includes(hero));});
}
const tierText=value=>value!==null&&value!==undefined&&/^(?:T)?\d+$/i.test(String(value).trim())?'T'+String(value).trim().replace(/^T/i,''):'暂无';
const rosterChampions=state=>[...new Set([state.me.champion,...state.allies.map(p=>p.champion),...state.enemies.map(p=>p.champion),...state.bench.map(p=>p.champion)].filter(v=>typeof v==='string'&&v.trim()))].slice(0,state.phase==='ChampSelect'?30:11);
// 资料库偶尔把内部文件错误原文当提示语返回，玩家看不懂也不需要看路径，这里统一换成一句人话。
const friendlyKnowledgeMessage=message=>{
 const text=String(message??'').trim();
 if(!text)return '';
 return /文件不存在|移动或删除|ENOENT|no such file|路径|path/i.test(text)
  ?'资料库暂无该英雄的数据（不影响本局判断）'
  :text;
};
// 智能体动态兜底：没有活动回合时，把本局事件流（装备/海克斯/团灭…）当作行喂进去，
// 面板就不会整块空着——这类信息本来就是玩家想看的。
const EVENT_FALLBACK_LIMIT=6;
// 对局状态“只在变化时露一次”：记住上次的英雄/等级/KDA 组合与显示截止时间。
let liveStatsKey='';let liveStatsUntil=0;
// —— 战况页内联信息（原「海克斯页 / 胜率页」的内容）——
// 页签取消后，这些内容以「新消息」形式进入战况时间线；brief 是给窄条/收起态的一行速览，
// 方便玩家一眼决断。同 key 只记一次，最多保留 20 条。
const noticePush=(state,key,{text,brief,stage,dimension,at,table,footer,slots}={})=>{
 if(!text)return false;
 const list=state.notices??(state.notices=[]);
 if(list.some(n=>n.key===key))return false;
 list.push({key,text,brief:String(brief??''),stage:stage??'',dimension:dimension??'',at:Number(at)||Date.now(),...(table?{table}:{}),...(footer?{footer}:{}),...(slots?{slots}:{})});
 state.notices=list.slice(-20);
 return true;
};
const noticeUpsert=(state,key,payload)=>{
 const list=state.notices??(state.notices=[]);
 const existing=list.find(n=>n.key===key);
 if(existing){existing.text=payload.text;existing.brief=String(payload.brief??'');if(payload.table)existing.table=payload.table;if('footer' in payload)existing.footer=payload.footer;if(payload.slots)existing.slots=payload.slots;return false;}
 return noticePush(state,key,payload);
};
export const withEventFallback=(activity,state)=>{ const base=activity??{supported:false,enabled:false,revision:0,rows:[]};
 let rows=Array.isArray(base.rows)?base.rows:[];
 // 事件并入智能体动态：正在进行的那几步保留，后面接上本局事件；面板显示最近几行。
 // 装备更新（尤其敌方/别人的）属于出装页，塞进这里会把真正的事件全挤掉（实测 40 条里 25 条是它）。
 // 只有真正在跑（running/draft）才算进行中；queued 是排队等背压，实测会长时间
 // 占住这一行，导致整局都看不到事件。
 const KEEP_WORKING=new Set(['running','draft']);
 const working=rows.filter(row=>KEEP_WORKING.has(String(row?.phase??'')));
 // 只把「确实发生了什么」的事件放进动态：团灭/塔/水晶/龙/先锋/多杀/阵亡/海克斯三选一与已选。
 // 疑似识别、面板关闭提示、装备更新这些既不准也不重要，会把关键事件挤掉。
 // 事件流展示范围：关键对局事件 + 装备更新 + 疑似强化识别 + 聊天框 OCR 到的买卖/强化公告。
 // 之前为了防刷屏把装备和疑似识别滤掉了，但玩家需要看到这些细节，改为放宽并在别处控制总量。
 const FEED_KINDS=new Set(['Ace','TurretKilled','InhibKilled','InhibRespawningSoon','InhibRespawned','DragonKill','BaronKill','HeraldKill','Multikill','Death','augment_offer','augment_picked','inventory','augment_mutate','chat_events','purchase']);
 const stateKinds=new Set(['GameStart','GameEnd']);
 // 归属未确认的识别不进面板：OCR 合并了行时说不清是谁的强化，显示出来只会误导。
 const unattributed=event=>String(event.kind??'')==='augment_mutate'
  && /归属未确认|：无 ·|：未知 ·|归属不明/.test(String(event.text??''));
 const events=(Array.isArray(state?.events)?state.events.filter(event=>!stateKinds.has(event.kind)&&FEED_KINDS.has(String(event.kind??''))&&!unattributed(event)).slice(-EVENT_FALLBACK_LIMIT):[]).map((event,index)=>({
  id:'event-'+(event.at??index)+'-'+(event.key??''),task:'events',topic:'本局事件',
  clock:event.time??'',label:String(event.text??'').slice(0,60),phase:'done'}));
 // 单行显示：有正在进行的回合就显示步骤，空闲时显示最新事件。
 // 两者不混排——混排时"最新"可能是比当前步骤更旧的事件，看起来像卡住。
 if(working.length||events.length)rows=working.length?working:events;
 if(!rows.length)return base;
 // 最新的排最上面；顶部常驻一行对局状态（时间/英雄/等级/KDA/金币），随状态刷新跳动。
 const me=state.me??{};
 // 英雄/等级/KDA 任一变化才把这段状态露出来（金币每时每刻都在变，不参与触发）。
 const statsKey=[state.match??'',me.champion??'',me.level??'',me.k??'',me.d??'',me.a??''].join('|');
 if(statsKey!==liveStatsKey){liveStatsKey=statsKey;liveStatsUntil=Date.now()+20000;}
 const showLive=state.game!=='generic'&&Date.now()<liveStatsUntil;
 const live=showLive?['对局 '+(state.gameSeconds!=null?clock(state.gameSeconds):'--'),
  (me.champion??''),me.level!=null?'Lv'+me.level:'',
  (me.k!=null&&me.d!=null&&me.a!=null)?me.k+'/'+me.d+'/'+me.a:'',
  me.gold!=null?me.gold+' 金':''].filter(Boolean).join(' · '):'';
 const ordered=rows.slice().reverse();
 // 对局状态不再单独占一行：直接拼到最新那条事件前面（实测两行会被认为是重复占位）。
 if(live&&ordered.length){
  const head=ordered[0];
  ordered[0]={...head,label:live+' · '+String(head.label??'')};
 }else if(live){
  ordered.push({id:'match-live',task:'match',topic:'对局',clock:'',label:live,phase:'live'});
 }
 return {...base,rows:ordered};
};

// 战况/出装等页面的正文可能来自模型或资料库，会带「来源…」和链接。视图出口统一剥一次，
// 这样任何页面都不会再把来源甩给玩家（之前只剥了播报那一条路径）。
const needsStrip=value=>typeof value==='string'&&/https?:\/\/|来源|\*\*|`/.test(value);
// 视图字段里既有字符串也有对象数组（thread 就是 [{role,text,...}]），
// 只遍历顶层字符串会漏掉数组里的正文——实测战况页因此还显示「来源 + 链接」。
const stripDeep=value=>{
 if(typeof value==='string')return needsStrip(value)?stripSources(value):value;
 if(Array.isArray(value))return value.map(stripDeep);
 if(value&&typeof value==='object'){
  const out={};
  for(const [key,item] of Object.entries(value))out[key]=stripDeep(item);
  return out;
 }
 return value;
};
// 导出供用例直接验证（避免只靠人工看界面）。
export const stripViewSources=view=>{
 const out={};
 for(const [key,value] of Object.entries(view))out[key]=stripDeep(value);
 return out;
};
export function overlayView(state, knowledge = {}) {
  const me = state.me;
  const rows = knowledge.rows ?? [];
  const hero = rows.find(row => row._viewKind==='hero' && heroStatMatches(row,me.champion));
  const own = items(state.game==='lol'?list(me.items).filter(isCompletedItem):me.items);
  const players = [...state.allies.map(p => ({ ...p, side: '友' })), ...state.enemies.map(p => ({ ...p, side: '敌' })),...state.bench.map(p=>({...p,side:'备选'}))];
  if(!players.length&&me.champion)players.push({...me,side:'我'});
  // 数据里的英雄名带称号（如"虚空女皇 卑尔维斯"），界面只显示名字部分。
// 官方名之外，玩家更常用的口语叫法（按需补充）。
const CHAMPION_NICKNAME={
 '蒙多医生':'蒙多','赫卡里姆':'人马','沃利贝尔':'狗熊','奥瑞利安·索尔':'龙王','特朗德尔':'巨魔',
 '卡西奥佩娅':'蛇女','玛尔扎哈':'蚂蚱','伊泽瑞尔':'EZ','亚托克斯':'剑魔','泰达米尔':'蛮王',
 '贾克斯':'武器','易大师':'剑圣','布里茨':'机器人','阿利斯塔':'牛头','索拉卡':'奶妈',
 '内瑟斯':'狗头','维迦':'小法','费德提克':'稻草人','辛吉德':'炼金','厄加特':'螃蟹',
 '斯卡纳':'蝎子','约里克':'掘墓','卡兹克':'螳螂','科加斯':'大虫子','雷克塞':'挖掘机',
 '希瓦娜':'龙女','诺提勒斯':'泰坦','维克兹':'大眼','阿木木':'木木','凯尔':'天使',
 '奈德丽':'豹女','伊莉丝':'蜘蛛','菲奥娜':'剑姬','泰隆':'男刀','卡特琳娜':'卡特',
 '悟空':'猴子','卡尔玛':'扇子妈','奥莉安娜':'球女','崔丝塔娜':'小炮','库奇':'飞机',
 '黑默丁格':'大发明家','吉格斯':'炸弹人','阿兹尔':'沙皇','雷克顿':'鳄鱼','基兰':'时光',
 '沃里克':'狼人','塔姆·肯奇':'塔姆','布兰德':'火男','厄运小姐':'女枪','格雷福斯':'男枪',
 '瑟庄妮':'猪妹','阿狸':'狐狸','乐芙兰':'妖姬','克格莫':'大嘴','图奇':'老鼠',
 '悠米':'猫猫','塔莉垭':'岩雀','塔里克':'宝石','卡蜜尔':'卡密尔','斯维因':'乌鸦',
 '迦娜':'风女','娑娜':'琴女','艾翁':'树精','雷恩加尔':'狮子狗','娜美':'美人鱼',
 '伊芙琳':'寡妇','斯莫德':'小火龙','奥拉夫':'狂战士','凯特琳':'女警','古拉加斯':'酒桶',
 '瑟提':'腕豪','努努和威朗普':'努努','菲兹':'小鱼人','艾瑞莉娅':'刀妹','黛安娜':'皎月',
 '蕾欧娜':'日女','拉莫斯':'龙龟','弗拉基米尔':'吸血鬼','萨科':'小丑','莫甘娜':'莫甘娜'};
const shortChampion=(name)=>{const s=String(name??'').trim();if(!s)return '';const parts=s.split(/\s+/);const base=parts.length>1?parts.slice(1).join(' '):s;return CHAMPION_NICKNAME[base]??CHAMPION_NICKNAME[s]??base;};
const playerRows = players.map(p => {
    const r=rows.find(row=>row._viewKind==='hero'&&heroStatMatches(row,p.champion));
    const rate=r?.winRate!=null&&r.winRate!==''?Number(r.winRate):NaN;
    const winRate=Number.isFinite(rate)&&rate>=0&&rate<=100?rate:null;
    return {side:p.side,champion:p.champion||'未知英雄',winRate,
      winRateText:winRate!==null?`${Number(winRate.toFixed(2))}%`:'暂无数据',tierText:tierText(r?.tier)};
  }).sort((a,b)=>(b.winRate??-1)-(a.winRate??-1));
  const roster=playerRows.map(p=>`${p.side} ${p.champion} · ${p.winRateText} · ${p.tierText}`);
  const weighted=side=>{const result=teamStrength(playerRows,side);return result.value===null?`待补齐 ${result.known}/5`:`${Number(result.value.toFixed(1))}%`;};
  const liveEstimate=state.game==='lol'?liveTeamEstimate(playerRows,{seconds:state.gameSeconds,allyKills:me.teamKills,enemyKills:me.enemyKills,sideSource:me.sideSource}):null;
  const teamWinRates=state.game==='lol'?(liveEstimate?`局势估计 · 我方 ${liveEstimate.ally}%｜敌方 ${liveEstimate.enemy}% · ${liveEstimate.allyKills}:${liveEstimate.enemyKills}`:`加权样本 · 我方 ${weighted('友')}｜敌方 ${weighted('敌')}`):'';

  const builds = rows.filter(r => r._type === 'coreBuilds').map(r => `${items(r.items)}\n  样本胜率 ${percent(r.winRate)} · 使用率 ${percent(r.pickRate)}`);
  const ranked = rankedAugments(rows, me.champion);
  // —— 把原「海克斯页 / 胜率页」的内容按时机写进战况时间线 ——
  (() => {
    if(state.game!=='lol')return;
    // 没有数据时不要把「暂无数据 暂无」堆两列，只留阵营与英雄名。
    const champName=shortChampion(me.champion)||String(me.champion||'本英雄');
    const rosterLine=row=>{
      const blank=value=>!value||/^暂无/.test(String(value));
      return [row.side,row.champion,blank(row.winRateText)?'':row.winRateText,blank(row.tierText)?'':row.tierText].filter(Boolean).join(' ');
    };
    const owned=state.ownedAugments??[];
    // 1) 三选一出现：给出本次可选项在该英雄上的排名（决断用）
    const offeredNow=offerNames(state.offers);
    if(offeredNow.length){
      const round=Number.isInteger(Number(state.offerRound))?Number(state.offerRound):null;
      const roundKey=round!==null?'aug-offer:r'+round:'aug-offer:'+offeredNow.slice().sort().join('|');
      const pick=ranked.filter(row=>offeredNow.includes(row.name));
      // 三个选项都要出现：有排名的给排名与品质，没排名的明确写“暂无排名”，
      // 否则玩家看不到那张卡（实测漏掉过「超负荷」）。
      const rankOf=new Map(pick.map(row=>[row.name,row]));
      const order=[...pick.map(row=>row.name),...offeredNow.filter(name=>!rankOf.has(name))];
      // 三个候选按游戏面板的「左/中/右」排位输出：玩家一眼能对上说的是哪张卡，
      // 重掷时只有对应位置的内容变化，消息仍是同一条（按轮次 upsert，不新增）。
      const slotLabels=['左','中','右'];
      const slots=(state.offers??[]).slice(0,3).map((offer,index)=>{
        const raw=offer?.name??offerNames([offer])[0]??'';
        const row=rankOf.get(raw)??null;
        return {
          slot:slotLabels[index]??'',
          name:raw||'待识别',
          rank:row?(Number(row.rank)>0?'No.'+Number(row.rank):'未上榜'):'未上榜',
          tier:row?.tier??'',
        };
      });
      // 排名最高的那张标成推荐：rank 数字最小者，同分保留最左边的。
      let bestIndex=-1,bestRank=Infinity;
      slots.forEach((entry,index)=>{
        const value=entry.rank.startsWith('No.')?Number(entry.rank.slice(3)):NaN;
        if(Number.isFinite(value)&&value<bestRank){bestRank=value;bestIndex=index;}
      });
      if(bestIndex>=0)slots[bestIndex]={...slots[bestIndex],best:true};
      const lines=slots.map(entry=>entry.slot+' · '+entry.rank+' · '+entry.name+(entry.tier?' · '+entry.tier:''));
      // 语音只给一句结论：三个都在 30 名开外就让玩家刷新，否则直接推荐排名最高的那张。
      const rankOfSlot=entry=>{const hit=/^No\.(\d+)$/.exec(String(entry.rank??''));return hit?Number(hit[1]):null;};
      const rankedSlots=slots.map(entry=>({entry,value:rankOfSlot(entry)})).filter(item=>item.value!=null);
      const bestSlot=rankedSlots.sort((a,b)=>a.value-b.value)[0]??null;
      const offerBrief=!bestSlot?'三个都没进榜，建议刷新换一批'
        :bestSlot.value>30?'三个排名都在 30 名以外，建议刷新看看':('推荐选 '+bestSlot.entry.name+'（'+bestSlot.entry.rank+(bestSlot.entry.tier?' '+bestSlot.entry.tier:'')+'）');
      noticeUpsert(state,roundKey,{
        at:Date.now(),stage:'augment',dimension:'augment',
        slots,
        text:'海克斯三选一 · '+champName+'排名',
        brief:offerBrief.slice(0,90),
      });
    }
    // 2) 已选：识别到新的强化
    const picked=owned.at(-1);
    if(picked){
      const row=ranked.find(r=>r.name===picked);
      noticePush(state,'aug-picked:'+picked,{
        at:Date.now(),stage:'augment',dimension:'augment',
        text:`已选海克斯 · ${picked}`+(row?`（${champName} ${Number(row.rank)>0?'No.'+Number(row.rank):'排名未上榜'}${row.tier?' · '+row.tier:''}）`:''),
      });
    }
    // 3) 阵容：单条消息原地更新，内容用表格（阵营/英雄/胜率/强度）——
    //    以前拼成一行文字，中文宽度不齐看起来很乱；现在交给渲染层排成四列。
    //    选人阶段只列我方且不算加权；等加载页敌方五人都到齐，才出十人 + 加权胜率。
    const roster=playerRows.filter(row=>row.champion);
    // 十个人都在 roster 里、且每个人都有胜率，才算凑齐；缺人时不要拿半份数据当双方强度。
    const ratesComplete=roster.length>=10&&roster.every(row=>row.winRate!=null);
    const alliesRated=roster.filter(row=>row.side!=='敌'&&row.winRate!=null).length;
    const earlyPhase=state.phase==='ChampSelect'||['Loading','GameStart'].includes(state.phase)||(state.phase==='InProgress'&&Number(state.gameSeconds)<150);
    if(roster.length&&earlyPhase){
      const allies=roster.filter(row=>row.side!=='敌');
      const enemies=roster.filter(row=>row.side==='敌');
      const full=enemies.length>=5;
      // 没有数据时留空，由渲染层补「—」，避免出现「暂无数据 暂无」两列噪音。
      const cell=value=>{const text=String(value??'').trim();return !text||/^暂无/.test(text)?'—':text;};
      const tableRows=(full?[...allies,...enemies]:allies).map(row=>[cell(row.side),cell(row.champion),cell(row.winRateText),cell(row.tierText)]);
      noticeUpsert(state,'lineup',{
        at:Date.now(),stage:'loading',dimension:'plan',
        text:full?'双方阵容 · 十人胜率':'我方阵容 · 选人中'+'（敌方未知）',
        table:{head:['阵营','英雄','胜率','强度'],rows:tableRows,me:cell(me.champion)},
        // 十人齐且有全部胜率才给双方加权；没齐时只报我方，不出现「敌方 待补齐」。
        footer:full?(ratesComplete?teamWinRates:'加权样本 · 我方 '+(alliesRated>=5?weighted('友'):'待统计')):'',
        brief:full?(ratesComplete?('阵容 · '+(teamWinRates||'')):('阵容 · 我方 '+(alliesRated>=5?weighted('友'):'待统计'))).slice(0,90):'阵容 · 我方 '+allies.length+' 人已就位',
      });
    }
    // 4) 局势估计：十人胜率没凑齐之前不播报——缺人的估算会误导，玩家会以为那就是双方强度。
    // 同样原地更新（单条消息），幅度≥1 个百分点才改写，避免无意义刷新
    if(ratesComplete&&liveEstimate&&Number.isFinite(Number(liveEstimate.ally))){
      const ally=Number(liveEstimate.ally),previous=state.noticeWinRate??null;
      if(!previous||Math.abs(ally-Number(previous.ally))>=1){
        state.noticeWinRate={at:Date.now(),ally};
        noticeUpsert(state,'situation',{
          at:Date.now(),stage:'situation',dimension:'map',
          text:`局势估计 · 我方 ${ally}%｜敌方 ${liveEstimate.enemy}% · 击杀 ${liveEstimate.allyKills}:${liveEstimate.enemyKills}`,
          brief:`局势 ${ally}% vs ${liveEstimate.enemy}%`,
        });
      }
    }
  })();
  const combinations=rows.filter(r=>r._type==='combos').sort((a,b)=>Number(b.winRate)-Number(a.winRate)).slice(0,5).map(r=>{
    let cards=r.augments;try{if(typeof cards==='string')cards=JSON.parse(cards);}catch{cards=[];}
    const names=offerNames(Array.isArray(cards)?cards:[]);
    return names.length>1?names.join(' + ')+' · 样本胜率 '+percent(r.winRate):'';
  }).filter(Boolean);
  const offered = state.ended?[]:offerNames(state.offers);
 // Champion select: show each already-picked teammate's best partners so the next pick
 // can be chosen with the synergy on screen. Local dataset only, no model round-trip.
 const pickedChampions = [...new Set([state.me?.champion, ...list(state.allies).map(player => player?.champion)].filter(Boolean))];
 const partnerHint = state.game==='lol'&&state.phase==='ChampSelect'?champSelectPartnerText(pickedChampions,{limit:3,perChampion:3}):'';
  const augmentRankingRows = state.game==='lol'&&me.champion
    ? ranked.slice(0,10).map(row => ({
        rank: Number(row.rank)>0 && Number.isFinite(Number(row.rank)) ? '#'+Number(row.rank) : '—',
        name: String(row.name ?? ''),
        tier: /^T\d+$/i.test(row.tier ?? '') ? String(row.tier).toUpperCase() : '—',
      }))
    : [];
  const candidates = ranked.filter(row => offered.includes(row.name)).map(augmentLine);
  for(const name of offered)if(!ranked.some(row=>row.name===name))candidates.push(name+' · 排名未上榜');
  // Revocation is permanent: a later death or item swap must not revive old advice.
  // Two kinds are distinguished. "Hard" means the fact the advice stated is no longer
  // true (an ally ultimate that has since been used) and it must disappear. "Stale"
  // only means the match moved on: advice expires after 45-90s while automatic
  // analyses are spaced 60s+ apart, so without keeping the last text the page fell
  // back to a status label and the user effectively never saw any advice.
  for (const reply of state.broadcasts){
    // Anything revoked elsewhere (an ally ultimate that has since been consumed) stays
    // revoked for good.
    if (reply.revoked) reply.revokedHard = true;
    // Short-lived HUD reminders may be shown while fresh, but must never come back as
    // "slightly earlier advice": they assert a fact that stops being true within seconds.
    const ephemeral = !!reply.allyUltimate;
    const expired = !!(reply.expiresAt && Date.now()>=reply.expiresAt);
    const invalid = !adviceIsValid(reply.validity,state);
    if (reply.revokedHard || expired || invalid){
      reply.revoked = true;
      if (ephemeral) reply.revokedHard = true;
    } else {
      reply.revoked = false;
      reply.revokedHard = false;
    }
  }
  const validBroadcasts = state.broadcasts.filter(r => !r.revoked);
  const staleBroadcast = validBroadcasts.length ? null
    : [...state.broadcasts].reverse().find(r => !r.revokedHard && r?.text && (Date.now() - (Number(r.at)||0)) < 300000);
  const staleText = staleBroadcast ? staleBroadcast.text + '（稍早建议，局势已变化）' : '';
  // The battle page shows exactly one message: whatever matters for the situation the
  // player is in right now. Picking the newest broadcast regardless of context made a
  // stale purchase hint sit on screen while the player was dead and an ace window open.
  const live = reply => {
    switch (reply.key) {
      case 'death': return me.dead === true;
      case 'augment': return (state.offers?.length ?? 0) > 0;
      case 'purchase': return me.canShop === true;
      default: return true;
    }
  };
  // A message that answers the player's current state outranks a newer generic one.
  const situationBonus = reply => (reply.key === 'death' || reply.key === 'augment' || reply.key === 'purchase') ? 2 : 0;
  const score = reply => (Number(reply.priority) || 0) + situationBonus(reply);
  const byUrgency = (a, b) => score(b) - score(a) || (Number(b.at) || 0) - (Number(a.at) || 0);
  const fitting = validBroadcasts.filter(live).sort(byUrgency);
  const current = (fitting[0] ?? [...validBroadcasts].sort(byUrgency)[0])?.text || staleText || state.agentError || state.coachStatus?.label || (state.broadcasts.length?'局势已变化，正在更新针对性建议…':'等待进入游戏，检测到对局后自动生成策略建议。');
  const playbook=!state.ended&&state.augmentPlaybook?.owned===JSON.stringify([...state.ownedAugments].sort())&&state.augmentPlaybook.text!==current?'\n\n强化方案参考 · '+clock(state.augmentPlaybook.gameSeconds)+'\n'+state.augmentPlaybook.text:'';
  // Only for the opening window of a match: a greeting must not linger all game.
  const companionLine = state.companionLine && Date.now() - (Number(state.matchStartedAt) || 0) < 120000
    ? String(state.companionLine)
    : '';
  const augmentTitle='当前三选一 · '+(me.champion||'等待英雄')+(knowledge.loading?' · 刷新中…':'');
  const augmentBody=candidates.join('\n')+(offered.length<3?'\n已识别 '+offered.length+'/3 个位置，其余卡片继续识别中…':'');
  // 刷新次数：候选里最大的 rerollsUsed（同一轮三张一致），让玩家能回看是否刷过。
  const rerollCount=Math.max(0,...(Array.isArray(state.offers)?state.offers:[]).map(o=>Number(o?.rerollsUsed)||0));
  const rerollLine=rerollCount>0?'\n已刷新 '+rerollCount+' 次':'';
  const equipmentUpdates=state.events.filter(e=>e.topic==='equipment').slice(-12).map(e=>`${e.time} ${e.text}`).join('\n');
  const augmentUpdates=state.events.filter(e=>e.topic==='augment-selection').slice(-8).map(e=>`${e.time} ${e.text}`).join('\n');
  const captureHint=state.augmentCaptureAvailable===false
    ? state.augmentCaptureReason==='chinese_language_unavailable'?'系统未安装中文识别语言包，可在 Windows 设置添加简体中文文字识别；日志中的强化信息仍会同步。':'文字识别暂不可用，正在自动重试；日志中的强化信息仍会同步。'
    : state.augmentCaptureReason==='capture_failed'?'游戏画面暂未采集成功，正在自动重试；日志中的强化信息仍会同步。':'等待识别游戏内三选一面板';
  const heroStats = (state.game==='lol'?'大乱斗英雄样本胜率\n':'英雄样本胜率\n') + (hero ? `${hero.name??hero.champion} · ${hero.tier!=null?tierText(hero.tier):''} · ${percent(hero.winRate)}${hero.version ? ' · 版本 ' + hero.version : ''}` : friendlyKnowledgeMessage(knowledge.message) || '等待英雄知识检索');
  // 双方存活人数：教练要在被 busy/背压吞掉的 tick 里也能记住“配合窗口”，
  // 所以这里和云端的 aliveCounts 用同一套口径（先按英雄名去掉本人，再补自己一次）。
  const sideAlive=(()=>{
    if(typeof me.dead!=='boolean')return null;
    const self=String(me.champion??'');
    const alive=people=>list(people).filter(p=>p&&p.dead!==true&&String(p?.champion??'')!==self).length;
    return {alliesAlive:alive(state.allies)+(me.dead?0:1),enemiesAlive:alive(state.enemies)};
  })();
  return {
    game: state.game, mode:state.mode, match: state.match, matchStartedAt:state.matchStartedAt, gameTime: state.game==='generic'?(state.phase==='CapturePaused'?'观察已停止':'观察中'):clock(state.gameSeconds), phase:state.phase, ended: state.ended,
    ...(sideAlive??{}),
    selfChampion: shortChampion(me.champion),
    // The coach needs to know the player is dead before it decides whether it may spend a
    // turn: a death reminder is worth bypassing a busy voice queue, nothing else is.
    dead: me.dead===true, respawn: Number.isFinite(Number(me.respawn)) ? Number(me.respawn) : null,
    selfIdentityAt: state.selfIdentityAt,
    selfChampionAlias: typeof me.championAlias==='string' ? me.championAlias : '',
    // 窄条/收起态只显示一行：把内联信息的速览也排进播报队列（id 稳定，不会重复念）。
    playback:[...validBroadcasts.map(r=>({id:r.praiseChain?'praise:'+r.praiseChain:String(r.at)+':'+r.text,at:r.at,text:r.text,priority:r.priority??0,...(r.praise?{topic:'praise'}:{}),...(r.praiseChain?{praiseChain:r.praiseChain}:{}),expiresAt:r.expiresAt??r.validity?.expiresAt??null})),
     ...(state.notices??[]).filter(n=>n.brief&&Date.now()-n.at<300000).map(n=>({id:'notice:'+n.key,at:n.at,text:n.brief,priority:2,expiresAt:n.at+180000}))].sort((a,b)=>a.at-b.at),
    // 已安静、但还没上屏的连杀链：云端教练据此生成一句话点评。
    // 超过宽限仍未填充时由 settlePraise 用本地兜底补上。
    pendingPraise:Object.values(state.praiseChains??{}).filter(chain=>chain&&!chain.settled&&!chain.cloudFilled).map(chain=>({chain:chain.key+'@'+chain.chainAt,streak:chain.streak,side:chain.side,hero:chain.hero??'',victims:Array.isArray(chain.victims)?chain.victims:[],revenge:Array.isArray(chain.revenge)?chain.revenge:[],at:Number.isFinite(chain.lastAt)?chain.lastAt:0})),
    revokedPlayback:state.broadcasts.filter(r=>r.revoked).map(r=>String(r.at)+':'+r.text),
    keywords:[...new Set([me.champion,...state.allies.map(p=>p.champion),...state.enemies.map(p=>p.champion),...list(me.items).map(i=>typeof i==='string'?i:i.name),...state.ownedAugments,...offerNames(state.offers)].filter(Boolean))].slice(0,64),
    // 关键词按类型分开，界面才能用同一套配色给正文高亮与左侧类别标签上色。
    championKeywords:[...new Set([me.champion,...state.allies.map(p=>p.champion),...state.enemies.map(p=>p.champion)].filter(Boolean))].slice(0,24),
    itemKeywords:[...new Set(list(me.items).map(i=>typeof i==='string'?i:i.name).filter(Boolean))].slice(0,24),
    augmentKeywords:[...new Set([...state.ownedAugments,...offerNames(state.offers)].filter(Boolean))].slice(0,24),
    title: '金宝 · ' + (state.game === 'lol' ? '英雄联盟' : state.game === 'wzry' ? '王者荣耀' : me.genericState?.gameName??'游戏教练'),
    summary: state.game==='generic'?'所选窗口 · '+(me.genericState?.windowTitle??'等待观察'):[shortChampion(me.champion), me.level != null ? 'Lv' + me.level : '', me.k != null ? `${me.k}/${me.d ?? 0}/${me.a ?? 0}` : '', me.gold != null ? '金币 ' + me.gold : ''].filter(Boolean).join(' · '),
    // Cheap confirmation signal for the coach's pre-flight guard: it must decide whether
    // a turn is worth a context read without reading the context.
    ownedAugmentCount: state.ownedAugments.length,
    advice: (state.game==='generic'?[me.genericState?.gameName||'游戏身份待核实',me.genericState?.gameMode,me.genericState?.roundState==='between'?'等待下一局':'当前窗口观察中']:['对局 '+clock(state.gameSeconds),shortChampion(me.champion),me.level!=null?'Lv'+me.level:'',me.k!=null?`${me.k}/${me.d??0}/${me.a??0}`:'',me.gold!=null?'金币 '+me.gold:'']).filter(Boolean).join(' · ')+'\n\n'+(companionLine?companionLine+'\n\n':'')+current+playbook+(state.game==='lol'&&offered.length?'\n\n海克斯推荐 · 当前三选一\n'+candidates.join('\n'):'')+(state.game==='lol'&&state.ownedAugments.length?'\n\n本局已选海克斯\n'+state.ownedAugments.join('、'):'')+(partnerHint?'\n\n'+partnerHint:''),
    equipment: '当前装备\n' + (own || '等待装备日志') + '\n\n推荐出装\n' + (state.equipment || builds.join('\n\n') || friendlyKnowledgeMessage(knowledge.message) || '进入对局后自动检索并结合装备与海克斯更新建议。')+(!state.ended&&state.equipmentStatus?'\n'+state.equipmentStatus:'')+(state.equipmentAssumptions.length?'\n\n待确认的强化推测\n'+state.equipmentAssumptions.map(a=>`第${a.round}轮暂按 ${a.name} 考虑`).join('\n'):'')+(equipmentUpdates?'\n\n装备动态\n'+equipmentUpdates:''),
    augments: state.game==='wzry'?'王者荣耀常规对局没有海克斯强化。可在战况页查看建议，或通过聊天咨询当前局势。':
      (offered.length?augmentTitle+'\n按该英雄适配排名排序\n'+augmentBody+rerollLine+'\n\n':'')+(state.game==='lol'&&me.champion&&augmentRankingRows.length?'英雄 Top10 海克斯 · '+(shortChampion(me.champion)||'等待英雄')+'\n\n':'英雄 Top10 海克斯 · '+(shortChampion(me.champion)||'等待英雄')+'\n'+(ranked.slice(0,10).map(augmentLine).join('\n')||friendlyKnowledgeMessage(knowledge.message)||'正在查询英雄适配排名…')+'\n\n')+'资料库推荐组合 · '+(me.champion||'等待英雄')+'\n'+(combinations.join('\n')||'暂无该英雄的组合记录')+
      (offered.length?'\n\n本轮已见 '+state.offerHistory.length+'/6':'\n\n'+captureHint)+'\n\n本局已选\n'+(state.ownedAugments.join('、')||'尚未收到强化选择日志')+(augmentUpdates?'\n\n强化动态\n'+augmentUpdates:''),
    // 英雄专属排名用表格渲染（三列等宽），文本里不再重复这段列表。
    augmentsRankingRows: augmentRankingRows,
    augmentsIsRanking: augmentRankingRows.length>0,
    players: (teamWinRates?teamWinRates+'\n\n':'')+'英雄胜率 ↓\n'+(roster.join('\n') || '等待双方英雄数据。'),
    teamWinRates,
    knowledgeStatus:knowledge.failed?friendlyKnowledgeMessage(knowledge.message):'',
    leaderboard:knowledge.leaderboard??null,
    teamWinRatesNote:liveEstimate?LIVE_ESTIMATE_NOTE:TEAM_STRENGTH_NOTE,
    liveTeamEstimate:liveEstimate,
    // 供智能体动态顶部常驻显示：对局时间/等级/KDA/金币，随每次状态刷新跳动。
    liveStats: state.game==='generic'?null:{
     clock: clock(state.gameSeconds),
     champion: (me.champion??''),
     level: me.level??null,
     kda: (me.k!=null&&me.d!=null&&me.a!=null)?me.k+'/'+me.d+'/'+me.a:'',
     gold: me.gold??state.gold??null,
    },
    confirmation:augmentConfirmation(state,rows),
    heroStats,
    playerRows,
    stats: heroStats+'\n\n'+roster.join('\n'),
    teamfight: state.teamfight || '可在聊天中询问本局团战打法；建议会结合双方阵容和当前装备。',
    // The events page now mirrors exactly the window the Agent receives, so "why did it
    // ignore that event?" is answerable from the UI instead of from logs. Held-back rows
    // are called out rather than silently hidden.
    events: (()=>{const {rows,heldBack}=eventWindow(state.events);const body=rows.map(e=>`${e.time} ${e.text}`).join('\n');return (body||'等待关键事件：装备购买、海克斯选择、团灭和重要目标。')+(heldBack?`\n（更早 ${heldBack} 条未进入智能体上下文，可在聊天中要求查询）`:'');})(),
    chat: state.chat.slice(-12).map(r => `${r.role === 'user' ? '我' : '教练'}：${r.text}`).join('\n\n') || '输入问题，与教练讨论当前对局。',
   // The battle page is one conversation: advice the coach published and the turns the
   // player exchanged are merged into a single chronological stream, oldest first.
   thread: (() => {
    const turns = state.chat.map(r => ({ role: r.role, origin: r.origin ?? '', text: r.text, failed: r.failed === true, at: Number(r.at) || 0, kind: 'chat' }));
    const spoken = state.broadcasts.map(b => ({ role: 'assistant', origin: 'coach', text: b.text, at: Number(b.at) || 0, kind: b.topic === 'praise' ? 'praise' : 'advice', dimension: b.dimension ?? '', stage: b.stage ?? '' }));
    // 原海克斯页/胜率页的内容以同一条时间线出现，玩家不用切页就能看到。
    // table/footer 透传给渲染层：阵容这类内容排成四列表格，比拼一行文字整齐得多。
    const notices = (state.notices ?? []).map(n => ({ role: 'assistant', origin: 'coach', text: n.text, at: n.at, kind: 'notice', dimension: n.dimension ?? '', stage: n.stage ?? '', ...(n.table?{table:n.table}:{}) , ...(n.footer?{footer:n.footer}:{}) , ...(n.slots?{slots:n.slots}:{}) }));
    return [...spoken, ...notices, ...turns].filter(r => r.text).sort((a, b) => a.at - b.at).slice(-40);
   })(),
   // Events are too long to list here; the page keeps only the newest line and updates it.
   eventTicker: (() => { const last = state.events.at(-1); return last ? `${last.time ?? ''} ${last.text ?? ''}`.trim() : ''; })(),
    chatRows: state.chat.slice(-40).map(r => ({role:r.role,origin:r.origin??'',text:r.text,failed:r.failed===true})),
    suggestedQuestion: suggestOverlayQuestion(state),
    // 经验库给出的历史段落（已带标题与实际字节预算）；教练消息里包含整份 context，
    // 因此把它放进视图就等于放进提示词，无需再改消息构造。
    experience: typeof state.experienceSection==='string' ? state.experienceSection : '',
    status: state.agentStatus|| (knowledge.loading ? '正在检索推荐…' : ''), updatedAt: state.at,
  };
}

export async function createOverlayService({ stateDir, agentChat, agentImage, search, pollMs = 500, equipmentDebounceMs=2000, equipmentCooldownMs=30000, equipmentOpeningRetryMs=15000, knowledgeRetryMs=15000,activity,canAutoRequest,experience=null,praiseCloudGraceMs=30000 }) {
  search=createKnowledgeSearch(search);
  const logs = join(stateDir, 'logs'), output = join(stateDir, 'overlay-state.json');
  await mkdir(logs, { recursive: true });
  const router=createOverlayRouter(), offsets = new Map();
  const memory = createGameMemory(stateDir);
 // Relationship state survives between matches; it only moves on recorded facts.
 const companion = createCompanion({ stateDir });
  let state=router.state();
  // Praise tone follows the mentor the player actually picked. That setting lives in
  // the speech settings written by the same process tree, so it is read lazily and
  // cached briefly instead of threading a role callback through every caller.
  let praiseRole='jinbao', praiseRoleAt=0;
  const currentPraiseRole=async()=>{
    if(Date.now()-praiseRoleAt<5000)return praiseRole;
    praiseRoleAt=Date.now();
    try{const saved=JSON.parse(await readFile(join(stateDir,'speech-settings.json'),'utf8'));if(PRAISE_ROLES.includes(saved?.role))praiseRole=saved.role;}catch{}
    return praiseRole;
  };
  let restoredChat;
  try{const saved=JSON.parse(await readFile(join(stateDir,'overlay-chat.json'),'utf8'));if(saved&&Array.isArray(saved.chat))restoredChat=saved;}catch{}
  if(restoredChat&&!restoredChat.game&&!restoredChat.match){state.chat=restoredChat.chat.slice(-50);restoredChat=null;}
  let knowledge = {}, knowledgeKey = '', refreshTask = null, refreshQueued = false, scanning = false, closed = false, busy = false;
  // 等待态总榜（performRefresh 里写入，视图直接读，避免被 knowledge 覆盖丢掉）
  let leaderboardData = null;
  let lastIdleLeaderboardAt = 0;
  // 启动后先给 5 秒宽限：状态可能是空的，此时不该立刻拉总榜（会白白多两次请求）
  const bootAt = Date.now();
  let forceRefresh = false, cached = { key: '', rows: [], candidates: new Map(), heroes: new Map() };
  let retryKnowledgeAt=Infinity;
  let lastForcedKnowledgeAt=0;
  const contextKey = () => state.game+':'+state.match+':'+state.matchStartedAt+':'+state.me.champion+':'+JSON.stringify([offerNames(state.offers).sort(),[...state.ownedAugments].sort(),rosterChampions(state).sort()]);
  const baseContextKey = () => state.game+':'+state.match+':'+state.matchStartedAt+':'+(state.phase==='ChampSelect'?'selection':state.me.champion);
  // 等待态（大厅空闲、没有当前英雄也没有备选席）用总榜填满两页，避免空着；
  // 有英雄或进入对局后立即回到原本的本局数据。
  // 什么算"没有对局"：结算/大厅/无对局都算。之前用"没有当前英雄"判断，
  // 打完一局后英雄名会一直留着，于是总榜永远不出现（实测结算态两页仍是本局数据）。
  const idleNoMatch=()=>state.game!=='wzry'&&(state.ended===true
   ||['EndOfGame','None','Lobby','WaitingForStats','Matchmaking','PreEndOfGame'].includes(String(state.phase??''))
   ||(!state.match&&!state.me.champion));
  const idleLeaderboard=()=>{
  const forceIdle=typeof staleForIdle!=='undefined'&&staleForIdle;
    const book=knowledge.leaderboard??leaderboardData;
    if(!(idleNoMatch()||forceIdle)||!book)return null;
    const hex=Array.isArray(book.hextech)?book.hextech:[];
    const heroes=Array.isArray(book.heroes)?book.heroes:[];
    if(!hex.length&&!heroes.length)return null;
    const names=new Map((knowledge.rows??[]).filter(row=>Number.isInteger(Number(row?.id))).map(row=>[Number(row.id),row.name]));
    const out={};
    if(hex.length){
     out.augments=hextechLeaderboardPage(hex);
     out.augmentsRows=leaderboardRowData(hex,{limit:10,withChampion:true});
     out.augmentsIsLeaderboard=true;
    }
    if(heroes.length){
     out.players=heroLeaderboardPage(heroes,{topRune:row=>{const id=topRuneId(row);return id===null?'':(names.get(id)??'');}});
     out.playersRows=leaderboardRowData(heroes,{limit:10});
     out.playersIsLeaderboard=true;
    }
    return out;
  };
  // 静止判定：日志停更（如对局结束时客户端退回大厅、或采集被打断）后，
  // 状态里的 phase 可能还残留在 InProgress，导致总榜不显示。用一个指纹判定“还在动”。
  let stateFingerprint='';let stateChangedAt=Date.now();
  let staleForIdle=false;
  // 日志总量与最后一次增长时间：日志不再变长才是真的“没在对局里”。
  let logBytes=-1;let logGrewAt=Date.now();
  const view=()=>{
   const fp=[state.phase,state.gameSeconds,state.match,state.me?.champion,state.me?.level,state.me?.k,state.me?.d,state.me?.a,state.me?.gold].join('|');
   if(fp!==stateFingerprint){stateFingerprint=fp;stateChangedAt=Date.now();}
   staleForIdle=Date.now()-stateChangedAt>150000;
   const idle=idleLeaderboard();
   // 胜率页默认渲染的是英雄表格；空闲总榜是文本，需要显式告诉渲染层改用文本。
   const built=stripViewSources({...overlayView(state,knowledge),...(idle??{}),playersIsLeaderboard:!!idle?.players,
    agentActivity:withEventFallback(activity?.snapshot?.(state),state)});
   // 正文开头的“对局 12:56 · 英雄 · Lv · KDA · 金币”这行已经并入智能体动态那条，
   // 再留在正文里就变成上下两行重复（实测被指出是重复占位）。
   if(built&&typeof built.advice==='string')built.advice=built.advice.replace(/^对局 [^\n]*\n+/,'');
   return built;
  };

  async function save() {
    if (closed) return;
    // 局结束时把这一局交给经验库（同一局只会提炼一次；未成交给胜负事实，因此只沉淀与胜负无关的教训）。
  if(experience && experience.pack){
   try{
    const tags=['game:'+(state.game||'lol')];
    if(state.me?.champion)tags.push('champ:'+state.me.champion);
    for(const name of state.ownedAugments??[])if(name)tags.push('aug:'+name);
    if(state.phase)tags.push('phase:'+String(state.phase).toLowerCase());
    if(state.me?.dead===true)tags.push('event:death');
    const packed=await experience.pack({tags});
    if(packed && packed.section!==state.experienceSection)state.experienceSection=packed.section;
   }catch{}
  }
  if(experience && state.ended){
   const facts={game:state.game,match:state.match,champion:state.me?.champion??'',ended:true,
    deaths:(state.events??[]).filter(e=>/阵亡|死亡|被击杀/.test(String(e?.text??''))).length,
    recognition:{blindFrames:Number(state.captureBlind)||0}};
   Promise.resolve().then(()=>experience.finish?.(facts)).catch(()=>{});
  }
  await writeFile(output + '.tmp', JSON.stringify(view()), { mode: 0o600 });
    await rename(output + '.tmp', output);
    await writeFile(join(stateDir,'overlay-chat.json'),JSON.stringify({game:state.game,match:state.match,matchStartedAt:state.matchStartedAt,chat:state.chat}),{mode:0o600});
    await memory.snapshot(state, knowledge.rows ?? []);
  }
  // Serialize disk snapshots: model requests and polling may finish concurrently.
  let writes = Promise.resolve();
  const flush = () => (writes = writes.catch(() => {}).then(save));
  const equipmentCoach=createEquipmentCoach({getState:()=>state,canRequest:canAutoRequest,agentChat,save:flush,onAdvice:async(current,answer,reason)=>{
     const stage=reason==='opening'?'opening':reason==='death'?'death':'purchase';
    const event={game:current.game,match:current.match,at:Date.now(),kind:'equipment-advice',broadcast:condenseAdvice(answer),priority:2,validity:createAdviceValidity(stage,current)};
    router.apply(event,'coach_broadcasts.jsonl');await appendFile(join(logs,'coach_broadcasts.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});
  },debounceMs:equipmentDebounceMs,cooldownMs:equipmentCooldownMs,openingRetryMs:equipmentOpeningRetryMs});
  function refresh(force = true) {
    if(closed)return Promise.resolve();
    if(force)search.clear();
    forceRefresh ||= force;
    if(refreshTask){refreshQueued=true;return refreshTask;}
    refreshTask=(async()=>{do{refreshQueued=false;await performRefresh();}while(refreshQueued&&!closed);})().finally(()=>{refreshTask=null;});
    return refreshTask;
  }
  async function performRefresh() {
    const selecting=state.phase==='ChampSelect';
    const champion = state.me.champion;
    const game = state.game;
    if (!champion&&!rosterChampions(state).length) throw Object.assign(Error('请先进入对局'), { status: 409 });
    const key = contextKey();
    const baseKey = baseContextKey();
    const force = forceRefresh; forceRefresh = false;
    if(force)search.clear();
    if(cached.key!==baseKey)cached={key:baseKey,rows:[],candidates:new Map(),heroes:new Map()};
    const cache = cached;
    const stillCurrent = () => !closed && key === contextKey();
    knowledge = { ...knowledge, loading: true }; await flush();
    // Record the attempt up front: if this line is missing afterwards the refresh never
    // started at all, which is a different bug from a lookup that returned nothing.
    try{await writeFile(join(stateDir,'knowledge-status.json'),JSON.stringify({at:Date.now(),phase:'started',game:state.game,match:state.match,champion:state.me.champion,rows:(knowledge.rows??[]).length}));}catch{}
    const errors=[];
    const failed=e=>errors.push(Number(e?.status)||503);
    try {
      const offered = offerNames(state.offers).slice(0,3);
      const base = async () => {
        if(selecting||!champion||(!force&&(cache.baseLoaded||Date.now()<(cache.baseRetryAt??0))))return;
        // 选完英雄后首次查询常常落空（名字还没解析好），15 秒的重试间隔让页面空着很久。
        // 未拿到数据时快速重试；拿到数据后 baseLoaded 会挡住后续重复查询。
        cache.baseRetryAt=Date.now()+1200;
        const results=await Promise.allSettled(game==='wzry'?[search({game,query:champion,limit:3})]:[
          search({game,query:champion,filter:{_type:'coreBuilds'},limit:3}),
          search({game,query:champion,filter:{_type:'augments'},limit:10}),
          search({game,query:champion,filter:{_type:'combos'},limit:5}),
        ]);
        for(const r of results)if(r.status==='rejected')failed(r.reason);
        const fresh=results.flatMap(r=>r.status==='fulfilled'?(r.value.results??[]).map(item=>item.data):[]);
        // An empty successful response can be a transient service/cache miss.
        // Keep useful rows and retry missing sections instead of marking the
        // whole hero lookup complete forever.
        const refreshedTypes=new Set(fresh.map(row=>row?._type));
        cache.rows=[...fresh,...cache.rows.filter(row=>!refreshedTypes.has(row?._type))];
        cache.baseLoaded=results.every(r=>r.status==='fulfilled'&&r.value.results?.length>0);
      };
      // 等待态（没有当前英雄）时取两份总榜，避免海克斯页/胜率页空着；
      // 数据是每日快照，缓存 10 分钟即可，进入对局后不再请求。
      // 只在真正空闲时取总榜：选人阶段（有备选席英雄）继续走既有的按英雄查询，
      // 否则会多打两次请求并和备选席数据重复。
      const idleWait=game==='lol'&&!champion&&!rosterChampions(state).length;
      if(idleWait&&(force||!cache.leaderboard||Date.now()-(cache.leaderboardAt??0)>600000)){
        const [hexRes,heroRes]=await Promise.allSettled([
          search({game,query:'大乱斗',dataset:'leaderboard',board:'hextech',limit:10}),
          search({game,query:'大乱斗',dataset:'leaderboard',board:'heroes',limit:20}),
        ]);
        const pick=res=>res.status==='fulfilled'?(res.value.results??[]).map(item=>item.data):[];
        const hexRows=pick(hexRes),heroRows=pick(heroRes);
        if(hexRows.length||heroRows.length){leaderboardData={hextech:hexRows,heroes:heroRows};cache.leaderboardAt=Date.now();}
        if(hexRes.status==='rejected')failed(hexRes.reason);
        if(heroRes.status==='rejected')failed(heroRes.reason);
      }
      // 面板刷新后会换出 Top10 里没有的强化名，排序/推荐就无从算起。
      // 这里按名字补查一次（最多 3 个，且按名字缓存），让确认面板能按真实排名排序。
      // 只有发生过刷新（reroll）才需要补查：首轮面板的候选已在 Top10 里，
      // 无条件补查会让首次查询多打请求（既有用例断言了检索次数）。
      const rerolled=(state.offers??[]).some(offer=>offer&&(offer.reroll===true||Number(offer.rerollsUsed??0)>0));
      if(game==='lol'&&champion&&rerolled){
        const offered=offerNames(state.offers).slice(0,3);
        const known=new Set(cache.rows.map(row=>row?.name).filter(Boolean));
        const need=offered.filter(name=>!known.has(name)&&!cache.optionRanked?.has(name));
        await Promise.all(need.map(async name=>{
          try{
            const result=await search({game,query:name,filter:{_type:'augments'},limit:10});
            const rows=(result.results??[]).map(item=>item.data).filter(row=>row&&row.name===name);
            if(rows.length){cache.rows=[...rows,...cache.rows];}
            cache.optionRanked=cache.optionRanked??new Set();cache.optionRanked.add(name);
          }catch{}
        }));
      }
      await Promise.all([base(),...rosterChampions(state).filter(name=>game==='lol'&&(force||!cache.heroes.has(name))).map(async name=>{
        try{
          const result=await search({game,query:name,dataset:'aram-ranking',limit:1});
          const found=(result.results??[]).map(item=>({...item.data,_viewKind:'hero'})).filter(row=>heroStatMatches(row,name));
          if(found.length)cache.heroes.set(name,found);
        }catch(e){failed(e);}
      }),...offered.filter(name=>game==='lol'&&champion&&(force||!cache.candidates.has(name))).map(async name=>{
        try{
        const result=await search({game,query:champion,filter:{_type:'augments',name},limit:1});
        const rows=(result.results??[]).map(item=>item.data);if(rows.length)cache.candidates.set(name,rows);
        if(cache.candidates.size>100)cache.candidates.delete(cache.candidates.keys().next().value);
        if(stillCurrent()){
          knowledge={...knowledge,rows:[...offered.flatMap(option=>cache.candidates.get(option)??[]),...cache.rows,...[...cache.heroes.values()].flat()],leaderboard:cache.leaderboard};
          updateAugmentRecommendations(state,knowledge.rows);await flush();
        }
        }catch(e){failed(e); /* Keep successful candidates and retry this slot later. */ }
      })]);
      if (stillCurrent()) knowledge = { rows: [...offered.flatMap(name=>cache.candidates.get(name)??[]),...cache.rows,...[...cache.heroes.values()].flat()].filter(row => row?._viewKind==='hero'|| (typeof row?.champion === 'string' && row.champion.includes(champion))||row?.name===champion||row?.title===champion), message: errors.includes(429)?'检索请求受限，稍后重试':errors.some(s=>s===401||s===403)?'检索授权暂不可用，请查看设置':errors.length?'检索暂时失败，正在重试':'未收录匹配的英雄数据', failed:errors.length>0 };
    } catch (e) {
      if(stillCurrent())knowledge = { message: e.status === 401 || e.status === 403 ? '请在设置页登录并开通攻略检索权限；自带模型密钥与检索权限独立。' : '推荐检索暂时不可用，可在聊天中咨询。' };
    } finally {
      retryKnowledgeAt=Date.now()+(errors.includes(429)?Math.max(60000,knowledgeRetryMs):knowledgeRetryMs);
      // Retrieval failures were invisible: the page only ever said "正在查询" and the log
      // recorded nothing, so a broken lookup looked like a slow one. Persist one line per
      // attempt so the next real match can be explained instead of guessed at.
      try{await writeFile(join(stateDir,'knowledge-status.json'),JSON.stringify({at:Date.now(),game:state.game,match:state.match,champion:state.me.champion,rows:(knowledge.rows??[]).length,errors,message:friendlyKnowledgeMessage(knowledge.message)??'',failed:!!knowledge.failed}));}catch{}
      updateAugmentRecommendations(state,knowledge.rows??[]);
      await flush();
      if(!stillCurrent()&&rosterChampions(state).length&&Date.now()-state.at<30000)void refresh(false).catch(()=>{});
    }
  }
  // The pixel watcher refuses when it cannot isolate one changed card, and saves the
  // before/after frames instead. A vision model gets one look at those two frames; a
  // parsed slot is a real observation, so it is injected through the same broadcast
  // path as any other derived fact. Anything less than a clean answer stays a
  // question for the player rather than a guess.
  const tiebreaks=new Set();
  // Rolls that already produced a pick: a late timeout for the same round must not ask
  // the vision model again and append a second, possibly different augment.
  const decidedRolls=new Set();
  async function runTiebreak(event){
   if(typeof agentImage!=='function'||closed)return;
   if(event.roll!=null&&decidedRolls.has(String(event.roll)))return;
   if(typeof event?.baselineImage!=='string'||typeof event?.lastImage!=='string')return;
   const key=[state.game,state.match,event.roll??'',event.baselineImage,event.lastImage].join('|');
   if(tiebreaks.has(key))return;
   tiebreaks.add(key);
   if(tiebreaks.size>32)tiebreaks.delete(tiebreaks.values().next().value);
   const options=Array.isArray(event.options)&&event.options.length?event.options:state.offers;
   try{
    const answer=await agentImage({question:TIEBREAK_QUESTION,images:[
     {path:event.baselineImage,mediaType:'image/png'},
     {path:event.lastImage,mediaType:'image/png'},
    ]});
    if(closed)return;
    const pick=tiebreakPick({answer,options,roll:event.roll});
    if(!pick)return;
    const applied={game:state.game,match:state.match,at:Date.now(),...pick};
    router.apply(applied,'coach_broadcasts.jsonl');
    await appendFile(join(logs,'coach_broadcasts.jsonl'),JSON.stringify(applied)+'\n',{mode:0o600});
    state=router.state();
    await flush();
   }catch{}
  }
  async function scan() {
    if (scanning || closed) return;
    scanning = true;
    // 空闲态（无对局/无英雄）也要取一次总榜：这是唯一在空闲时仍会执行的循环，只靠 performRefresh 内部的看门狗永远不会触发。
    // 空闲态直接取两份总榜（不经过 refresh：那条链路在无英雄时会被多处条件挡住，
    // 实测断点式排查代价太高）。取到后写回状态文件，两页即可显示总榜。
    // 完全空闲时 state.game 可能是空串（没有任何对局日志），所以不能用 ==='lol' 判断。
    // 用“日志是否还在增长”判断是否真的在对局中：对局结束后日志停止增长，
    // 但状态里的 phase 可能长期残留在 InProgress（重放旧日志也会不断刷新状态文件）。
    try{
     let total=0;
     for(const f of (await readdir(logs)).filter(x=>x.endsWith('.jsonl')&&!x.includes('overlay-chat'))){
      try{total+=(await stat(join(logs,f))).size;}catch{}
     }
     if(total!==logBytes){logBytes=total;logGrewAt=Date.now();}
     else if(Date.now()-logGrewAt>120000){staleForIdle=true;}
    }catch{}
    if (state.game !== 'wzry' && (idleNoMatch()||staleForIdle) && (!leaderboardData || Date.now()-(leaderboardData.at??0)>600000)
        && Date.now() - bootAt > 5000 && Date.now() - lastIdleLeaderboardAt > 60000) {
      lastIdleLeaderboardAt = Date.now();
      void (async () => {
        try {
          const [hexRes, heroRes] = await Promise.allSettled([
            search({game:'lol',query:'大乱斗',dataset:'leaderboard',board:'hextech',limit:10}),
            search({game:'lol',query:'大乱斗',dataset:'leaderboard',board:'heroes',limit:20}),
          ]);
          const pick = res => res.status === 'fulfilled' ? (res.value.results ?? []).map(item => item.data) : [];
          const hex = pick(hexRes), heroes = pick(heroRes);
        if(hex.length||heroes.length){leaderboardData={hextech:hex,heroes,at:Date.now()};flush();}
        try{await writeFile(join(stateDir,'leaderboard-status.json'),JSON.stringify({at:Date.now(),
         idle:idleNoMatch()||staleForIdle,phase:state.phase,ended:state.ended,champion:state.me.champion,
         hex:hex.length,heroes:heroes.length,
         hexErr:hexRes.status==='rejected'?String(hexRes.reason?.status??hexRes.reason?.message??'x').slice(0,80):'',
         heroErr:heroRes.status==='rejected'?String(heroRes.reason?.status??heroRes.reason?.message??'x').slice(0,80):''}));}catch{}
        } catch {}
      })();
    }
    try {
      const pending = [];
      for (const file of (await readdir(logs)).filter(f => f.endsWith('.jsonl') && !f.includes('overlay-chat'))) {
        const path = join(logs, file), info = await stat(path);
        let offset = offsets.get(file) ?? 0;
        const first = !offsets.has(file);
        if (info.size < offset) offset = 0;
        if (info.size <= offset) continue;
        const f = await open(path, 'r');
        try {
          const data = Buffer.alloc(Math.min(info.size - offset, 1024 * 1024));
          const { bytesRead } = await f.read(data, 0, data.length, offset);
          const buffer = data.subarray(0, bytesRead), end = buffer.lastIndexOf(10);
          if (end < 0) continue;
          const lines = buffer.subarray(0, end).toString('utf8').split('\n');
          if (first && offset > 0) lines.shift();
          let position = offset;
          for (const line of lines) {
            position += Buffer.byteLength(line, 'utf8') + 1;
            try { pending.push({ event: JSON.parse(line), file, position: { key: file + ':' + info.birthtimeMs, offset: position } }); } catch {}
          }
          offsets.set(file, offset + end + 1);
        } finally { await f.close(); }
      }
      pending.sort((a, b) => eventTimestamp(a.event)-eventTimestamp(b.event));
      const observedStates = new Set();
      const ambiguous=[];
      for (const { event, file, position } of pending) {
        updateAugmentRecommendations(state,knowledge.rows??[]);
        const observed = router.apply(event,file);
        if(event?.kind==='augment_picked'&&event.roll!=null)decidedRolls.add(String(event.roll));
        if(event?.kind==='augment_vision_ambiguous')ambiguous.push(event);
        if (observed) { await memory.record(observed,event,file,position); observedStates.add(observed); }
      }
      for (const observed of observedStates) await memory.snapshot(observed);
 // One opening line per match, one result per finished match.
 const startedEvent = pending.map(entry => entry.event).find(e => e?.kind === 'game_start' || e?.kind === 'match_start');
 const endedEvent = pending.map(entry => entry.event).find(e => e?.kind === 'event' && e.name === 'GameEnd');
 if (state?.match && startedEvent) state.companionLine = companion.touch({ game: state.game, match: state.match }) ?? null;
 if (state?.match && endedEvent) companion.recordResult({ win: endedEvent.Result === 'Win', match: state.match });
      await memory.flush();
      state=router.state();
      for(const event of ambiguous)void runTiebreak(event);
      try{const progress=JSON.parse(await readFile(join(stateDir,'coach-status.json'),'utf8'));state.coachStatus=progress.game===state.game&&progress.match===state.match&&Date.now()-progress.at<120000?progress:null;}catch{state.coachStatus=null;}
      try{const progress=JSON.parse(await readFile(join(stateDir,'agent-status.json'),'utf8'));const same=progress.game===state.game&&progress.match===state.match,age=Date.now()-Number(progress.at??0);state.agentStatus=same&&age<30000?String(progress.label??''):'';/* A failed model/auth round is worth showing far longer than a transient progress label; a successful turn rewrites this file with phase=complete and clears it. */state.agentError=same&&progress.phase==='error'&&age<120000?String(progress.label??''):'';}catch{state.agentStatus='';state.agentError='';}
      if(state.match&&restoredChat){
        if(restoredChat.game===state.game&&restoredChat.match===state.match&&restoredChat.matchStartedAt===state.matchStartedAt){
          state.chat=restoredChat.chat.slice(-50);restoredChat=null;
        }
      }
      try {
        const coach = JSON.parse(await readFile(join(stateDir, 'coach_live_state.json'), 'utf8'));
        if (coach.lastReply?.text&&coach.lastReply.match)router.apply({...coach.lastReply,broadcast:coach.lastReply.text},'coach');
      } catch {}
      const key = contextKey();
      if(key!==knowledgeKey){
        knowledgeKey=key;knowledge=cached.key===baseContextKey()?{rows:knowledge.rows??[]}:{};
        if(rosterChampions(state).length&&!state.ended&&Date.now()-state.at<30000)void refresh(false).catch(()=>{});
      }
      else if(!refreshTask&&Date.now()>=retryKnowledgeAt&&rosterChampions(state).length&&!state.ended&&Date.now()-state.at<30000&&(!cached.baseLoaded||rosterChampions(state).some(name=>!cached.heroes.has(name))||offerNames(state.offers).some(name=>!cached.candidates.has(name)))){
        retryKnowledgeAt=Date.now()+knowledgeRetryMs;void refresh(false).catch(()=>{});
      }
      // The page showed "正在查询…" forever because the refresh only ran when the context key
      // changed. If a champion is known and the lookup still has no rows, force one attempt
      // instead of waiting for a change that may never come.
      if(!closed&&!refreshTask&&!state.ended&&state.me.champion&&!(knowledge.rows??[]).length&&Date.now()-state.at<30000&&Date.now()>=lastForcedKnowledgeAt+30000){
 // 空闲态（没有当前英雄、没有备选席）也需要取一次总榜，否则两页永远是空文案：
 // 上面那条看门狗要求 state.me.champion，空闲时永远不会触发。
 if(!closed&&!refreshTask&&!state.ended&&state.game==='lol'&&!state.me.champion&&!rosterChampions(state).length
    &&!leaderboardData&&Date.now()-state.at<120000&&Date.now()>=lastForcedKnowledgeAt+30000){
  lastForcedKnowledgeAt=Date.now();void refresh(true).catch(()=>{});
 }
       lastForcedKnowledgeAt=Date.now();void refresh(true).catch(()=>{});
      }
      // 多杀点评优先交给云端生成一句话；这里先等 7 秒宽限（云端建单+轮询+出句
      // 实测 3~6 秒），超时没等到才用本地兜底，保证玩家听不到两句重复的播报。
      settlePraise(state, Date.now(), { role: await currentPraiseRole(), cloudGraceMs: praiseCloudGraceMs });
      await flush();
      if(!knowledge.loading)equipmentCoach.tick();
    } catch {} finally { scanning = false; }
  }
  await scan();
  const timer = setInterval(scan, pollMs); timer.unref();
  async function applyConfirmation({id,name,dismiss=false,timeoutDefault=false,historical=false}={},team=false){
    const accepted=team&&historical&&!dismiss&&!timeoutDefault?acceptedTeamRound(state,id,name):null;
    if(accepted?.confirmed?.length&&accepted.confirmationSource!=='countdown-default-confirmed'&&!accepted.confirmed.includes(name))throw Object.assign(Error('本轮已有不同的真实选择'),{status:409});
    if(accepted?.confirmed?.includes(name)&&accepted.confirmationSource!=='countdown-default-confirmed')return {confirmed:true};
    const prompt=accepted?{id,round:accepted.id,options:accepted.options.map(name=>({name}))}:augmentConfirmation(state,knowledge.rows??[],Date.now(),{allowAssumed:team});
    if(!prompt||id!==prompt.id||(!dismiss&&!prompt.options.some(o=>o.name===name)))throw Object.assign(Error('确认已过期或选项已变化'),{status:409});
    if(timeoutDefault&&(team||dismiss||prompt.options[0]?.name!==name))throw Object.assign(Error('默认选项已变化'),{status:409});
    const round=state.augmentRounds.find(row=>row.id===prompt.round);
    const event={game:state.game,match:state.match,t:Date.now(),roll:prompt.round,confirmationId:prompt.id,...(dismiss?{kind:'augment_confirmation_dismissed'}:{kind:'augment_picked',who:'self',augment:name,
      source:team?'team-user-confirmed':timeoutDefault?'countdown-default-confirmed':'user-confirmed',confidence:'high',time:state.gameSeconds,
      ...(team&&round?.confirmationSource==='countdown-default-confirmed'?{replaces:[...round.confirmed]}:{})})};
    await appendFile(join(logs,'lol-user-confirmations.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});
    router.apply(event,'lol-user-confirmations.jsonl');equipmentCoach.invalidate();await flush();equipmentCoach.tick();return {confirmed:!dismiss};
  }
  return {
    view, refresh,
    async getTeamFacts(){return state.game&&state.match?{...(await memory.currentFacts(state.game,state.match)).current,confirmation:augmentConfirmation(state,knowledge.rows??[],Date.now(),{allowAssumed:true})}:null;},
    confirm:input=>applyConfirmation(input),
    confirmTeamSelection:input=>applyConfirmation(input,true),
    async ask(question, topic, metadata = {}) {
      if (busy) throw Object.assign(Error('教练正在回复'), { status: 409 });
      if (typeof question !== 'string' || !question.trim() || question.length > 1000) throw Object.assign(Error('问题格式不正确'), { status: 400 });
      busy = true;
      const game=state.game||'lol',match = state.match, started = state.matchStartedAt;
      const stillCurrent = () => state.match === match && state.matchStartedAt === started;
      const q = { role: 'user', text: question.trim(), origin: metadata.origin === 'phone' ? 'phone' : 'desktop', at: Date.now() }; state.chat.push(q);
      state.chat = state.chat.slice(-50);
      try {
        await memory.record(state, { kind: 'chat', ...q, gameSeconds: state.gameSeconds }, 'overlay-chat');
        await flush();
        if(!stillCurrent())throw Object.assign(Error('对局已切换，请在当前对局重新提问'),{status:409});
        if (!agentChat) throw Object.assign(Error('DSH Agent 聊天接口尚未就绪，请重新打开金宝'), { status: 503 });
        const answer = await agentChat({ game, match: match || 'waiting', question: q.text, topic:topic??'chat',priority:'manual' });
        if(!stillCurrent())throw Object.assign(Error('对局已切换，请在当前对局重新提问'),{status:409});
        if(typeof answer!=='string'||!answer.trim())throw Object.assign(Error('Empty Agent answer'),{status:502});
        const reply=answer.trim();
        state.chat.push({ role: 'assistant', text: reply, at: Date.now() });
        await memory.record(state, { kind: 'chat', role: 'assistant', text: reply, gameSeconds: state.gameSeconds }, 'overlay-chat');
        if(topic==='teamfight')state.teamfight=text(answer);
        if(topic==='equipment')state.equipment=text(answer);
        if(topic==='augments')state.augmentAdvice=text(answer);
        return { answer: reply };
      } catch (e) {
        if(stillCurrent())state.chat.push({ role: 'assistant', text: chatFailureMessage(e), failed:true, at: Date.now() });
        throw e;
      } finally { busy = false; await flush(); }
    },
    async close() { closed = true; search.close(); equipmentCoach.close(); clearInterval(timer); await writes.catch(() => {}); await memory.flush(); },
  };
}
