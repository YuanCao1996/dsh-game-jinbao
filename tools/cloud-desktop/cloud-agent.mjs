import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {serviceUrl,limitedJson} from '../dsh-game-services/client.mjs';
import {equipmentContext} from '../dsh-onboarding/equipment-context.mjs';
import {eventWindow} from '../dsh-coach-server/lib/event-window.mjs';
import {roleInstruction} from './roles.mjs';
import {commonChampionName} from '../dsh-coach-server/lib/advice-names.js';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function agentQuestion(request){
 let message=request.question;
 if(request.topic==='equipment'&&typeof message==='string'&&message.includes('【装备决策事实 JSON】'))message=message.split('【装备决策事实 JSON】')[0].replace('只用 coach_reply 提交','直接提交')+'\n按需读取当前事实中的 equipment_decision；区分 confirmedAugments 与 assumedAugments，推测不当作已拥有。';
 if(typeof message!=='string'||!message.trim()||message.length>12000)throw fail(413,'Agent message exceeds the bounded task budget');
 const role=[roleInstruction(request.role,request.game,request.automatic===true),...(request.game==='generic'?['通用识别中，identityEvidence的tentative只是推测，corroborated只是多帧印证，source=user才是用户确认；分别核实游戏名、模式和版本。按需看图或检索日志，不从窗口标题猜规则。处于between阶段时不延续上一局操作建议；搜索使用当前gameName、gameMode及可用版本，资料不匹配则说明未知。']:[]),...(request.automatic===true?['低频短播报：2~3 个短句，每句不超过 20 字，用换行分开；像边想边说，先说现在做什么，再补一句为什么；省略铺垫，不为凑字数编造内容。','当前对局状态、阵容、装备与海克斯已经在上下文里：不要为了看局势反复调用 get_current_match_state，只有上下文缺字段时才查一次。']:[])].filter(Boolean).join('\n');
 if(role&&message.length+role.length+1>12000)throw fail(413,'Agent message exceeds the bounded task budget');
 return role?message+'\n'+role:message;
}
// 本局实体名 → 检索关键词，随请求带给后端预加载使用。
function localKnowledgeNames(c){
 const names=[];
 const push=v=>{const s=String(v??'').trim();if(s&&!names.includes(s))names.push(s);};
 push(c?.me?.champion);
 for(const offer of (Array.isArray(c?.offers)?c.offers:[]))push(typeof offer==='string'?offer:offer?.name);
 for(const aug of (Array.isArray(c?.ownedAugments)?c.ownedAugments:[]))push(typeof aug==='string'?aug:aug?.name);
 for(const item of (Array.isArray(c?.me?.items)?c.me.items:[]))push(typeof item==='string'?item:item?.name);
 return names.slice(0,12).join('、');
}
export function cloudContext(memory,game,match,{eventQuery=false,observationPlan=false,userMemory=false,experience=false}={}){
 const c=memory.current;
 if(c&&(c.game!==game||c.match!==match))throw fail(409,'Match changed');
 const compact=value=>typeof value==='string'?value.slice(0,120):value&&typeof value==='object'?Object.fromEntries(['name','id','count','level','ready','cooldown'].filter(k=>['string','number','boolean'].includes(typeof value[k])).map(k=>[k,typeof value[k]==='string'?value[k].slice(0,120):value[k]])):value;
 const player=p=>p?Object.fromEntries(['champion','level','gold','dead','hpPct','k','d','a','items','spells','roles','canShop','respawn'].filter(k=>p[k]!==undefined).map(k=>[k,Array.isArray(p[k])?p[k].slice(0,8).map(compact):compact(p[k])])):undefined;
 const equipment=c&&game!=='generic'?equipmentContext({...c,me:c.me??{},enemies:c.enemies??[],ownedAugments:c.ownedAugments??[],augmentRounds:c.augmentRounds??[]}):undefined;
 // 双方十人名单直接注入模型上下文：称号 + 常用名。
 // 以前提示词要求“只用 facts.lineup”，但请求里根本没这个字段，模型只能从
 // team_chat 的 OCR 名字里猜，实测因此编出了不在本局的“腕豪/瑟提”。
 const rosterEntry=entry=>{const title=String(entry?.champion??'').trim();return title?{title,common:String(commonChampionName(title)||title)}:null};
 const selfEntry=rosterEntry(c?.me),allyEntries=(c?.allies??[]).slice(0,5).map(rosterEntry).filter(Boolean),enemyEntries=(c?.enemies??[]).slice(0,5).map(rosterEntry).filter(Boolean);
 const lineup=(selfEntry||allyEntries.length||enemyEntries.length)?{self:selfEntry,allies:allyEntries,enemies:enemyEntries,all:[selfEntry,...allyEntries,...enemyEntries].filter(Boolean).map(entry=>entry.title),common:[selfEntry,...allyEntries,...enemyEntries].filter(Boolean).map(entry=>entry.common)}:undefined;
 // 提示词引用的 facts.* 字段也直接给一份，别让模型只能靠工具或聊天区猜。
 const itemName=item=>typeof item==='string'?item:String(item?.name??'');
 const itemsOf=player=>(player?.items??[]).map(itemName).filter(Boolean).slice(0,8);
 const equipmentEvents=Array.isArray(c?.completedEquipmentEvents)?c.completedEquipmentEvents:[];
 const recentEquipment=equipmentEvents.slice(-3).map(event=>{
  const when=Number(event?.at);
  const seconds=Number(event?.time);
  const minutesAgo=Number.isFinite(seconds)&&Number.isFinite(Number(c?.gameSeconds))?Math.max(0,Math.round((Number(c.gameSeconds)-seconds)/60)):Number.isFinite(when)&&Number.isFinite(Number(c?.at))?Math.max(0,Math.round((Number(c.at)-when)/60000)):null;
  return {hero:String(event?.hero??''),items:(event?.items??[]).map(String).slice(0,4),minutesAgo};
 }).filter(event=>event.minutesAgo!==null?event.minutesAgo<=3:true);
 const multikillEvent=[...(c?.events??[])].reverse().find(event=>event?.kind==='event'&&String(event.name??event.EventName??'')==='Multikill');
 const facts={lineup,
  me:c?.me?{champion:String(c.me.champion??''),common:String(commonChampionName(c.me.champion??'')||''),level:c.me.level??null,gold:c.me.gold??null,dead:c.me.dead??null,hpPct:c.me.hpPct??null,kda:[c.me.k,c.me.d,c.me.a].every(value=>Number.isFinite(Number(value)))?[Number(c.me.k),Number(c.me.d),Number(c.me.a)]:null,items:itemsOf(c.me)}:null,
  offers:(c?.offers??[]).map(offer=>String(offer?.name??'')).filter(Boolean).slice(0,6),
  multikill:{streak:Number.isFinite(Number(multikillEvent?.KillStreak))?Number(multikillEvent.KillStreak):null},
  recentEquipment,
  priorOpeningPlan:c?.openingBuild?{text:String(c.openingBuild).slice(0,160)}:null,
  recentAdvice:(c?.broadcasts??[]).slice(-2).map(broadcast=>String(broadcast?.text??'').slice(0,120)).filter(Boolean),
  augmentSelections:(c?.augmentSelections??[]).slice(-6).map(row=>({hero:String(row?.hero??''),side:String(row?.side??''),augment:String(row?.augment??''),gameSeconds:row?.gameSeconds??null})),
  userNotes:Array.isArray(c?.userNotes)?c.userNotes.slice(-3):[]};

 const value={current_match_state:{game_id:game,status:c?'observed':'unknown',revision:c?.at??0,captured_at_ms:c?.at??Date.now(),
  game_seconds:c?.gameSeconds,mode:c?.mode,phase:c?.phase,me:player(c?.me),allies:c?.allies?.slice(0,5).map(player),enemies:c?.enemies?.slice(0,5).map(player),
  generic_state:game==='generic'?c?.me?.genericState:undefined,
  team_score:Number.isInteger(c?.me?.teamKills)&&Number.isInteger(c?.me?.enemyKills)?{ally:c.me.teamKills,enemy:c.me.enemyKills}:undefined,
  bench:c?.phase==='ChampSelect'?c?.bench?.slice(0,20):undefined,
  offers:c?.offers?.slice(0,6).map(compact),owned_augments:c?.ownedAugments?.slice(0,12).map(compact),
  equipment_decision:equipment?{...equipment,currentItems:equipment.currentItems.slice(0,8).map(compact),enemies:equipment.enemies.slice(0,5).map(e=>({hero:String(e.hero??'').slice(0,120),roles:Array.isArray(e.roles)?e.roles.slice(0,3):[],skills:Array.isArray(e.skills)?e.skills.slice(0,2):[],summonerSpells:Array.isArray(e.summonerSpells)?e.summonerSpells.slice(0,2):[],items:e.items.slice(0,8).map(compact),augments:Array.isArray(e.augments)?e.augments.slice(0,4):[]})),unassignedEnemyItems:equipment.unassignedEnemyItems.slice(0,8).map(compact),enemyAugments:equipment.enemyAugments.slice(0,8),confirmedAugments:equipment.confirmedAugments.slice(0,12).map(compact),assumedAugments:equipment.assumedAugments.slice(0,6)}:undefined},
  events:eventWindow(c?.events).rows,client_context:{game_id:game,mode:c?.mode??'',capabilities:{event_query_v1:eventQuery,observation_plan_v1:game==='generic'&&observationPlan,user_memory_v1:userMemory,experience_v1:experience},user_memory:{confirmed_preferences:(memory.preferences??[]).slice(-6)},team_chat:(Array.isArray(c?.chat)?c.chat.filter(row=>row&&row.origin==='team'&&row.text).slice(-6).map(row=>({who:String(row.displayName??'').slice(0,24),text:String(row.text).slice(0,80),self:row.self===true})):[]),lineup,facts}};
 const oversized=()=>Buffer.byteLength(JSON.stringify(value))>24000;
 while(oversized()&&value.events.length){value.events.shift();value.client_context.context_reduced=true;}
 while(oversized()&&value.client_context.user_memory.confirmed_preferences.length){value.client_context.user_memory.confirmed_preferences.shift();value.client_context.context_reduced=true;}
 if(oversized())throw fail(413,'Current facts exceed the bounded context budget');
 return value;
}
export function createCloudAgent({getToken,getContext,isCurrent=()=>true,onProgress=()=>{},capture,queryEvents,observationPlan,memoryTools,experienceTools,onObservation,
 getActivityEnabled=()=>false,serviceBaseUrl='https://api.jinbaoai.top',apiPrefix='/desktop/agent',deviceId='default',fetchImpl=fetch,pollMs=800,timeoutMs=90000}){
 if(!['/desktop/agent','/desktop/agent-preview'].includes(apiPrefix))throw Error('Invalid Agent route');
 const service=serviceUrl(serviceBaseUrl);const lifetime=new AbortController(),teardown=new AbortController();let busy=false,settled=Promise.resolve(),finish=()=>{},wireRevision=0,wireKey='',wireValue,waitForCancellation=false;
 function transportContext(memory,request){
  const value=cloudContext(memory,request.game,request.match,{eventQuery:!!queryEvents,observationPlan:!!observationPlan,userMemory:!!memoryTools,experience:!!experienceTools});
  if(getActivityEnabled()||(request.topic==='chat'&&request.priority==='manual'))value.client_context.capabilities.agent_activity_v1=true;
  value.client_context.task={automatic:request.automatic===true,topic:['advice','equipment','praise','chat'].includes(request.topic)?request.topic:'chat',time_critical:request.timeCritical===true}
    // 自动建议不带聊天区：OCR 出来的“champion/称号”是噪声，模型会当成阵容事实。
    if(request.automatic===true) delete value.client_context.team_chat;
  // 已选强化的名字单独给一份：服务端按名字查本地索引，把确定的效果文本直接写进提示词，
  // 这样即使模型自己不检索（问法含糊、检索失败），播报也不会写成「效果文本未收录」。
  value.client_context.owned_augments=(value.current_match_state?.owned_augments??[])
    .map(item=>typeof item==='string'?item:String(item?.name??'')).filter(Boolean).slice(0,8);
   const critical=request.timeCritical===true;
 const lk=critical?null:localKnowledgeNames(memory);
   if(lk)value.client_context.local_knowledge=lk;;
  if(value.current_match_state.status==='unknown')delete value.current_match_state.captured_at_ms;
  const key=JSON.stringify(value);
  if(key!==wireKey){wireRevision=Math.max(Date.now(),wireRevision+1);value.current_match_state.source_revision=value.current_match_state.revision;value.current_match_state.revision=wireRevision;wireKey=key;wireValue=value;}
  return structuredClone(wireValue);
 }
 async function call(path,token,data,signal,key){
  const response=await fetchImpl(new URL(apiPrefix+path,service),{method:data===undefined?'GET':'POST',redirect:'error',signal,
   headers:{Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(!response.ok){
  const retryAfterMs=Math.min(30000,Math.max(1000,Number(response.headers.get('retry-after'))*1000||5000));
  let code='';
  try{const detail=await response.json();if(typeof detail?.code==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(detail.code))code=detail.code;}catch{await response.body?.cancel().catch(()=>{});}
  throw Object.assign(fail(response.status,'Cloud Agent request failed'+(code?': '+code:'')),{retryAfterMs,...(code?{code}:{...(response.status===429?{code:'rate_limited'}:{})})});
}
  return limitedJson(response,256*1024);
 }
 return {async ask(request){
  if(busy){
    // 同一时间只允许一个任务：等前一个结束，而不是把这次请求直接判失败。
    const waitUntil=Date.now()+12000;
    while(busy&&Date.now()<waitUntil){try{await settled;}catch{}}
    if(busy){const error=fail(409,'Cloud Agent is busy');error.code='agent_busy';throw error;}
  }
  busy=true;
  settled=new Promise(resolve=>{finish=resolve;});
  let task,token,terminal=false;const signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(timeoutMs)]);
  const current=()=>isCurrent(request.game,request.match);
  const progress=event=>{const value={...event,game:request.game,match:request.match,topic:request.topic,requestId:request.activityId};onProgress(value);try{request.onProgress?.(value);}catch{}};
  try{
   token=await getToken();if(!token)throw fail(401,'Login required');if(!current())throw fail(409,'Match changed');
   const session='desktop-'+createHash('sha256').update(JSON.stringify([deviceId,request.game,request.match])).digest('hex');
   const context=transportContext(await getContext(request.game,request.match),request);
   const message=agentQuestion(request);
   const key=randomUUID();let created;
   for(let attempt=0;attempt<2;attempt++){
    try{created=await call('/tasks',token,{session_id:session,message,context},signal,key);break;}
    catch(error){if(error.status||signal.aborted||attempt)throw error;}
   }
   if(!/^[a-f0-9-]{32,36}$/.test(created.task_id??''))throw fail(502,'Invalid task');task=created.task_id;
   // 手动提问的玩家在屏幕前等结果：503/504 这类上游故障多试一次就够，
   // 否则一次提问要等三轮 20 秒（实测 2026-11-12 23:32 那条提问等了 61 秒才失败）。
   // 后台自动任务机会成本低，仍保留两次。
   const transientRetries=request.priority==='manual'||request.topic==='chat'?1:2;
   let cursor=0,revision=context.current_match_state.revision,nextContextAt=0,pollFailures=0;const handled=new Set();
   while(true){
    signal.throwIfAborted();if(!current())throw fail(409,'Match changed');
    let update;
    try{update=await call('/tasks/'+task+'?after='+cursor,token,undefined,signal);if(pollFailures)progress({event:'connection_restored'});pollFailures=0;}
    catch(error){if(error.status===429){progress({event:'rate_limited'});await sleep(error.retryAfterMs,undefined,{signal});continue;}if(!signal.aborted&&(!error.status||[502,503,504].includes(error.status))&&pollFailures++<transientRetries){progress({event:'connection_retry'});await sleep(250*pollFailures,undefined,{signal});continue;}throw error;}
    if(!Number.isSafeInteger(update.cursor)||update.cursor<cursor)throw fail(502,'Invalid cursor');cursor=update.cursor;
    const terminalUpdate=['completed','failed','cancelled'].includes(update.status);
    for(const event of (Array.isArray(update.activity)?update.activity:[]).slice(-8)){
     if(event.event==='public_text'&&typeof event.text==='string'&&event.text.length<=1800&&Number.isSafeInteger(event.seq))progress({event:'public_text',text:event.text,reset:true,seq:event.seq,channel:'activity'});
    }
    for(const event of update.events??[]){
     progress(event);
     if(event.event==='generic_observation'&&request.game==='generic'&&onObservation&&current()){
      try{await onObservation({...event,game:request.game,match:request.match});}catch{}
      if(!current())throw fail(409,'Match changed');
     }
     if(!terminalUpdate&&event.event==='memory_requested'&&!handled.has(event.request_id)){
      if(!/^[a-f0-9]{32}$/.test(event.request_id??''))throw fail(502,'Invalid memory request');handled.add(event.request_id);
      let result={status:'unavailable',reason:'memory_unavailable'};
      try{if(memoryTools&&current())result=await memoryTools({...request,args:event.args});}catch{}
      if(!current())throw fail(409,'Match changed');
      if(!result||typeof result!=='object'||Buffer.byteLength(JSON.stringify(result))>10000)result={status:'unavailable',reason:'memory_unavailable'};
      await call('/tasks/'+task+'/memory-results',token,{request_id:event.request_id,result},signal);
     }
     if(!terminalUpdate&&event.event==='experience_requested'&&!handled.has(event.request_id)){
      if(!/^[a-f0-9]{32}$/.test(event.request_id??''))throw fail(502,'Invalid experience request');handled.add(event.request_id);
      let result={status:'unavailable',reason:'experience_unavailable'};
      try{if(experienceTools&&current())result=await experienceTools({...request,args:event.args});}catch{}
      if(!current())throw fail(409,'Match changed');
      if(!result||typeof result!=='object'||Buffer.byteLength(JSON.stringify(result))>12000)result={status:'unavailable',reason:'experience_unavailable'};
      await call('/tasks/'+task+'/experience-results',token,{request_id:event.request_id,result},signal);
     }
     if(!terminalUpdate&&event.event==='observation_plan_requested'&&!handled.has(event.request_id)){
      if(!/^[a-f0-9]{32}$/.test(event.request_id??''))throw fail(502,'Invalid plan request');handled.add(event.request_id);let status='unavailable';
      try{if(request.game==='generic'&&observationPlan&&current()){await observationPlan(event.plan);status='applied';}}catch{}
      if(!current())throw fail(409,'Match changed');await call('/tasks/'+task+'/plan-results',token,{request_id:event.request_id,status},signal);
     }
     if(!terminalUpdate&&event.event==='events_requested'&&!handled.has(event.request_id)){
      if(!/^[a-f0-9]{32}$/.test(event.request_id??''))throw fail(502,'Invalid event request');
      handled.add(event.request_id);let result={status:'unavailable',reason:'event_query_unavailable'};
      try{if(queryEvents)result=await queryEvents({game:request.game,match:request.match,args:event.query});}catch{}
      if(!current())throw fail(409,'Match changed');
      if(!result||typeof result!=='object'||Buffer.byteLength(JSON.stringify(result))>14000)result={status:'unavailable',reason:'event_query_unavailable'};
      await call('/tasks/'+task+'/event-results',token,{request_id:event.request_id,...result},signal);
     }
     if(!terminalUpdate&&event.event==='screen_requested'&&!handled.has(event.request_id)){
      handled.add(event.request_id);let frame;
      try{frame=await capture?.({game:request.game,match:request.match});}catch{}
      if(!current())throw fail(409,'Match changed');
      const fresh=frame?.captured_at_ms&&Date.now()-frame.captured_at_ms<=30000&&frame.game===request.game&&frame.match===request.match;
      await call('/tasks/'+task+'/attachments',token,fresh?{request_id:event.request_id,captured_at_ms:frame.captured_at_ms,image_base64:frame.image_base64}:{request_id:event.request_id,status:'unavailable',reason:'screen_unavailable'},signal);
     }
    }
    if(update.status==='completed'){terminal=true;if(typeof update.reply!=='string'||!update.reply.trim())throw fail(502,'Empty reply');return update.reply;}
    if(['failed','cancelled'].includes(update.status)){
     terminal=true;
     // 服务端 failed 的任务一律被映射成 503，真实原因在 update.error/update.reason 里。
     // 过去只有形如 model_quota_denied 的小写串才会被带走，其余（空、中文、混合大小写）
     // 全被吞掉 —— 2026-11-12 那条聊天失败因此只留下 httpStatus:503，查不到真正原因。
     const rawReason=String(update.error??update.reason??update.detail??'').trim();
     const quota=/quota|rate_limit|RATE_LIMIT|DAILY_QUOTA/i.test(rawReason);
     const error=fail(quota?429:503,'Cloud Agent task failed'+(rawReason?': '+rawReason.slice(0,120):''));
     error.retryable=false;
     error.code=/^[A-Za-z0-9_.-]{1,80}$/.test(rawReason)?rawReason:(rawReason?'task_failed_detail':'task_failed');
     if(rawReason)error.detail=rawReason.slice(0,160);
     throw error;
    }
    const latest=transportContext(await getContext(request.game,request.match),request);
    if(latest.current_match_state.revision>revision&&Date.now()>=nextContextAt){
     try{await call('/context',token,{session_id:session,context:latest},signal);revision=latest.current_match_state.revision;nextContextAt=Date.now()+2000;}
     catch(error){if(error.status!==429)throw error;nextContextAt=Date.now()+error.retryAfterMs;progress({event:'rate_limited'});}
    }
    await sleep(getActivityEnabled()?Math.min(pollMs,500):pollMs,undefined,{signal});
   }
  }catch(error){if(signal.aborted&&!lifetime.signal.aborted)throw fail(504,'Agent analysis timed out');throw error;}finally{
   if(task&&!terminal&&token){
    try{
     let receipt=await call('/tasks/'+task+'/cancel',token,{},AbortSignal.timeout(5000));
     // A cancel acknowledgement only sets the server's cancellation flag. Keep
     // the next manual turn behind the old task until its worker is terminal.
     if(waitForCancellation&&['queued','running'].includes(receipt.status)){
      progress({event:'cancellation_wait'});const cleanup=AbortSignal.any([teardown.signal,AbortSignal.timeout(45000)]);
      while(['queued','running'].includes(receipt.status)){
       receipt=await call('/tasks/'+task+'?after=0',token,undefined,cleanup);
       if(['queued','running'].includes(receipt.status))await sleep(500,undefined,{signal:cleanup});
      }
     }
    }catch{}
   }
   busy=false;finish();
  }
 },busy:()=>busy,abortRetirement(){teardown.abort();},async close({reason}={}){waitForCancellation=reason==='preempt';if(!waitForCancellation)teardown.abort();lifetime.abort();await settled;}};
}
