// Lightweight log collection with native Windows OCR; no strategy database or model credential.
import { readCredentials } from './lockfile.mjs';
import { lcuRequest } from './lcu.mjs';
import { getAllGameData,compactState,diffEvents } from './live.mjs';
import { createEventLog, pruneEventLogs, pruneCaptureFrames } from './eventlog.mjs';
import { stateEvent } from './collector-state.mjs';
import { createChampionSelectionReader } from './champ-select.mjs';
import { createChatObserver,createChatCatalogReader } from './chat-observer.mjs';
import { createAugmentObserver,augmentNames } from './augment-observer.mjs';
import { mapPickedSlot } from './augment-map.mjs';
import {createAugmentCaptureWorker} from './capture-worker.mjs';
import {createCaptureSchedule} from './capture-schedule.mjs';
import {createItemCatalogue} from './item-policy.mjs';
import {createHudAssets} from './hud-assets.mjs';
import {createAllyUltimateObserver} from './ally-ultimates.mjs';
import {createVisionVerify} from './vision-verify.mjs';
import {createVisionAssist,snapAugmentName} from '../shared/vision-assist.mjs';
import {shouldEndOnSilence,silenceEndEvents,SILENCE_END_MS} from './silence.mjs';
import {clockGlitch,startsNewMatch} from './match-clock.mjs';
import { homedir } from 'node:os';
import { join,dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {writeFile,rename,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const folder=process.env.JINBAO_LOG_DIR??join(homedir(),'.dsh','jinbao','logs');
// 状态目录：补识别的侧车图（vision-strip.jpg / vision-chat.jpg）就写在这里。
const stateDir=process.env.JINBAO_STATE_DIR??dirname(folder);
// Old match logs filled 160MB over ten days; keep the recent ones only.
try{const pruned=pruneEventLogs(folder);if(pruned.removed.length)console.log('pruned old logs: '+pruned.removed.length+', kept '+pruned.kept);}catch{}
try{const frames=pruneCaptureFrames(dirname(folder));if(frames.removed.length)console.log('pruned old frame folders: '+frames.removed.length+', kept '+frames.kept);}catch{}
let log=createEventLog(folder,'client-'+Date.now()),phase=null,lastEvent=-1,gameTime=null;
let nextMatch=true;
// 采集静默：客户端崩溃/断连时日志停止增长，超时就判本局结束（阈值可用 env 覆盖）。
let lastDataAt=0,silenceEnded=false;const silenceEndMs=Number(process.env.JINBAO_SILENCE_END_MS)||SILENCE_END_MS;
const readSelection=createChampionSelectionReader(lcuRequest);
let selectionLog=null,selectionMatch=null;
console.log('LoL collector started; waiting for client. Logs: '+folder);
let running=true,lastLiveState=null,capturing=false,lastCaptureAvailable=null,nextCaptureAt=0,captureGeneration=0;
const captureStop=new AbortController();
const captureWorker=createAugmentCaptureWorker({stateDir});
// 整屏 OCR 每次要 1–2 秒，正好卡在面板出现的瞬间；卡标题只要几百毫秒。
// 面板出现后能否立刻显示三选一，取决于标题帧多快轮到，所以整屏降到 4 秒一次。
const captureSchedule=createCaptureSchedule({fullIntervalMs:4000});
const names=await augmentNames();
// 云端补识别：本地 OCR/像素判定不确定时，拿侧车图问视觉模型；结果必须吸附到名录才采纳。
let visionVerify=null;
try{
 if(process.env.JINBAO_VISION_ASSIST!=='0'){
  const {createCredentials}=await import('../cloud-desktop/credentials.mjs');
  const credentials=await createCredentials(stateDir);
  const token=(await credentials.resolve('JINBAO_SERVICE_TOKEN'))?.value;
  if(token){
   const assist=createVisionAssist({
    stateDir,
    getToken:async()=>token,
    tier:process.env.JINBAO_VISION_TIER??'basic',
    budgets:{augment:1500,chat:2500},
    log:row=>{try{log.append({kind:'vision_assist',...row});}catch{}},
   });
   visionVerify=createVisionVerify({assist,catalogue:names});
   console.log('vision assist ready');
  }else console.log('vision assist skipped: no service token');
 }
}catch(error){console.error('vision assist unavailable: '+String(error?.message??error));}
let captureReportBusy=false,lastCaptureReport=0,captureSequence=0;
const captureReport=async value=>{
 if(captureReportBusy||Date.now()-lastCaptureReport<1000)return;
 captureReportBusy=true;lastCaptureReport=Date.now();
 const path=join(process.env.JINBAO_STATE_DIR??dirname(folder),'augment-diagnostics.json');
 try{await writeFile(path+'.tmp',JSON.stringify({at:Date.now(),sequence:++captureSequence,...value}),{mode:0o600});await rename(path+'.tmp',path);}catch{}finally{captureReportBusy=false;}
};
// 视觉判定：面板出现时另起一个进程，20Hz 采样三张卡，找出"只有它在变"的那张。
// 必须是独立进程——它要跑满整个面板期，占用 capture worker 会让采集停摆十几秒。
import { pickCardWatchDir } from './card-watch-dir.mjs';
const cardWatchScript=fileURLToPath(new URL('./card-watch.ps1',import.meta.url));
let cardWatch=null;
const stopCardWatch=()=>{if(cardWatch){const owned=cardWatch;cardWatch=null;try{owned.kill()}catch{}}};
const decidedRolls=new Set();

 // 把本轮信息写到抓帧目录，事后可核对“帧 ↔ 识别结果”。
 const writeCardWatchMeta=async meta=>{
 try{
  const root=process.env.JINBAO_STATE_DIR??dirname(folder);
  const entries=await readdir(root,{withFileTypes:true});
  const chosen=pickCardWatchDir(entries.filter(e=>e.isDirectory()).map(e=>e.name),meta.startedAt);
  if(!chosen)return;
  await writeFile(join(root,chosen,'meta.json'),JSON.stringify({...meta,endedAt:Date.now(),dir:chosen}));
 }catch{}
};
const startCardWatch=offer=>{
 stopCardWatch();
 // 抓帧元数据：这一轮开始时刻 + 当时识别到的名字，事后可核对帧与识别结果。
 const watchMeta={roll:offer?.roll??null,names:(Array.isArray(offer?.options)?offer.options:[]).map(o=>o?.name).filter(Boolean),startedAt:Date.now(),startedGameTime:lastLiveState?.gameTime??gameTime??null};
 const powershell=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 let child;
 try{child=spawn(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',cardWatchScript,'-Watch','-TimeoutMs','45000','-ClickLog',join(process.env.JINBAO_STATE_DIR??dirname(folder),'logs','overlay-clicks.jsonl')],{windowsHide:true,stdio:['ignore','pipe','ignore']});}catch{return;}
 cardWatch=child;
 const finish=()=>{
  if(cardWatch===child)cardWatch=null;
  void writeCardWatchMeta(watchMeta);
 };
 let buffer='';
 const onLine=line=>{
  let result;try{result=JSON.parse(line);}catch{return;}
  if(!running||!offer)return;
  // A watcher can outlive its own decision (the panel fades, or the same round is re-emitted
  // after a suspend). A second verdict for one round would append a second augment to the
  // owned list, so only the first verdict per round is accepted.
  const roundKey=offer.roll==null?null:String(offer.roll);
  if(roundKey!==null&&decidedRolls.has(roundKey))return;
  if(!Number.isInteger(result.picked)){
   const options=Array.isArray(offer.options)?offer.options:[];
   // 判定不出来时把两帧路径留下：既是视觉兜底的输入，也是阈值标定的原始数据。
   if(result.baselineImage&&result.lastImage)log.append({kind:'augment_vision_ambiguous',options:options.slice(0,3),roll:offer.roll??null,baselineImage:result.baselineImage,lastImage:result.lastImage,gameTime:lastLiveState?.gameTime??gameTime??null});
   // 真机事故（2026-11-12 狂厄蔷薇那局）：卡牌监视器整局没判定成功，
   // 「没判定出来」只在有两帧图时才留痕，其余情况静默返回；轮次随后被判 closed，
   // 但没有任何确认弹窗 —— 玩家 4 次三选一全丢，事后查不到原因。
   // 现在：无论有没有图都记一条 undecided（带 reason/帧数/耗时），并把这一轮关掉，
   // 让战况页弹确认，把选择权交回玩家。
   log.append({kind:'augment_pick_undecided',roll:offer.roll??null,reason:String(result.reason??'unknown'),options:options.slice(0,3),frames:Number.isFinite(Number(result.frames))?Number(result.frames):null,ms:Number.isFinite(Number(result.ms))?Number(result.ms):null,hasBaseline:!!result.baselineImage,hasLast:!!result.lastImage,gameTime:lastLiveState?.gameTime??gameTime??null});
   log.append({kind:'augment_offer_closed',roll:offer.roll??null,reason:'undecided',options:options.slice(0,3),gameTime:lastLiveState?.gameTime??gameTime??null});
   return;
  }
  const options=Array.isArray(offer.options)?offer.options:[];
  // Only a slot the offer actually captured may be named. A positional fallback attached
  // a neighbouring card's name to the pick in a real match (see augment-map.mjs).
  const mapped=mapPickedSlot(options,result.picked);
  if(!mapped||mapped.missing){
   // The pick happened but the offer never captured that card, so the name is unknown.
   // Closing the round is what lets the overlay ask the player instead of losing the
   // choice silently: an open, unconfirmed round raises no confirmation prompt at all.
   if(running){
    log.append({kind:'augment_vision_slot_missing',roll:offer.roll??null,slot:result.picked,options:options.slice(0,3),gameTime:lastLiveState?.gameTime??gameTime??null});
    log.append({kind:'augment_offer_closed',roll:offer.roll??null,reason:'slot-unread',slot:result.picked,gameTime:lastLiveState?.gameTime??gameTime??null});
   }
   return;
  }
  const name=mapped.name;
  if(typeof name!=='string'||!name)return;
  // 判定成功的这一条会把该轮标记为已确认，确认弹窗因此不再出现。
  if(roundKey!==null)decidedRolls.add(roundKey);
  try{observer.markPicked()}catch{}
  log.append({kind:'augment_picked',who:'self',name,augment:name,roll:offer.roll??null,source:'vision-click',confidence:'high',gameTime:lastLiveState?.gameTime??gameTime??null,visionReason:result.reason??'',visionFrames:result.frames??0});
  // 选定即关闭这一轮：否则最后一轮要等到下一轮 offer 才落账，赛后“本局已选”会缺最后一张。
  log.append({kind:'augment_offer_closed',roll:offer.roll??null,reason:'picked',gameTime:lastLiveState?.gameTime??gameTime??null});
 };
 child.stdout?.setEncoding('utf8');
 child.stdout?.on('data',chunk=>{buffer+=chunk;if(buffer.length>8192){stopCardWatch();return;}let end=buffer.indexOf('\n');while(end>=0){onLine(buffer.slice(0,end).trim());buffer=buffer.slice(end+1);end=buffer.indexOf('\n');}});
 child.on('error',finish);child.on('exit',finish);
};
const observer=createAugmentObserver(names,event=>{
 if(!running)return;
 log.append(event);
 if(event.kind==='augment_offer'){startCardWatch(event);void maybeCorrectOffer(event);}
 // 面板关闭不杀监视器：它的判定结果可能还差一帧才输出，让它自然结束（淡出即停或超时）。
});
// 本地读错的卡名用云端补读纠正：只在有名字吸附不上名录时触发，同一轮只试一次。
const correctedRolls=new Set();
const maybeCorrectOffer=async event=>{
 if(!visionVerify||!running)return;
 const roll=String(event.roll??'');
 if(!roll||correctedRolls.has(roll))return;
 const options=Array.isArray(event.options)?event.options:[];
 if(!options.some(option=>option?.name&&!snapAugmentName(option.name,names)))return;
 correctedRolls.add(roll);
 try{
  const result=await visionVerify.correctOffer({roll,options,stateDir,matchId:String(lastLiveState?.gameId??'')});
  if(result)log.append({kind:'augment_offer_corrected',roll:event.roll,options:result.options,previous:result.previous,ms:result.ms,model:result.model,source:'vision-model'});
 }catch{}
};
let chatEmitted=0,chatCorrectAt=0;
// 聊天：本地一行都没解析出来、但聊天区确实有字时，补读一次并走同一条解析链路。
const maybeCorrectChat=async frame=>{
 if(!visionVerify||!running)return;
 if(Date.now()-chatCorrectAt<4000)return;
 chatCorrectAt=Date.now();
 try{
  const result=await visionVerify.readChat({stateDir,matchId:String(lastLiveState?.gameId??'')});
  if(!result)return;
  const H=Number(frame.height)||1080;
  const lines=result.lines.map((text,index)=>{const y=H*0.58+index*22;return {text,box:[[10,y],[600,y],[600,y+18],[10,y+18]]};});
  chatObserver.observeLines(lines,lastLiveState,frame);
  log.append({kind:'chat_vision_lines',count:lines.length,ms:result.ms,model:result.model});
 }catch{}
};
const chatObserver=createChatObserver(names,event=>{if(running){chatEmitted+=1;log.append(event);}});
const readChatCatalog=createChatCatalogReader(lcuRequest);
let enrichItem=item=>item,championNames=new Map(),champions=[];
const ultimateObserver=createAllyUltimateObserver(event=>{if(running)log.append(event);});
const hudAssets=createHudAssets({stateDir:process.env.JINBAO_STATE_DIR??dirname(folder),load:async(id,signal)=>{
 const credentials=readCredentials();if(!credentials.ok)throw Error('Client unavailable');
 const result=await lcuRequest(credentials,`/lol-game-data/assets/v1/champion-icons/${id}.png`,{binary:true,timeoutMs:3000,signal});
 if(result.status!==200)throw Error('Portrait unavailable');return result.data;
}});
const acceptCatalog=catalog=>{chatObserver.setCatalog(catalog);if(catalog.items)enrichItem=createItemCatalogue(catalog.items);if(catalog.champions){champions=catalog.champions;championNames=new Map(champions.filter(c=>c.alias&&c.name).map(c=>[c.alias.toLowerCase(),c.name]));}};
const stop=()=>{running=false;stopCardWatch();captureStop.abort();captureWorker.close();void hudAssets.close();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
process.on('message',message=>{if(message?.action==='stop')stop();});
if(process.connected)process.once('disconnect',stop);
let lastDeadAt=false;
const captureTimer=setInterval(async()=>{
 if(!running||capturing||Date.now()<nextCaptureAt||!lastLiveState||!['KIWI','ARAM'].includes(lastLiveState.mode))return;
 capturing=true;nextCaptureAt=Date.now()+500;
 const generation=captureGeneration;
 const captureStarted=Date.now();
 try{
  // 三选一天然跟在阵亡之后（不是每次阵亡都有）：阵亡上升沿开 25 秒重点窗口，期间只跑标题帧。
  const deadNow=lastLiveState?.me?.dead===true;
  if(deadNow&&!lastDeadAt){captureSchedule.boost(25000);log.append({kind:'augment_scan_boost',reason:'death',at:Date.now()});}
  lastDeadAt=deadNow;
  const frame=await captureWorker.capture(captureStop.signal,{focus:captureSchedule.choose()});
  if(running&&generation===captureGeneration&&lastLiveState){
   observer.observe(frame);
   if(frame.focus!=='titles')ultimateObserver.observe(frame,lastLiveState,hudAssets.key());
   const diagnostic=observer.status();
   void captureReport({available:frame.available===true,foreground:frame.foreground===true,panelOccluded:frame.panelOccluded===true,focus:frame.focus,chatLines:Number(frame.chatLines??0),recognized:diagnostic.recognized,knownSlots:diagnostic.knownSlots,reason:diagnostic.reason??frame.reason,captureBackend:frame.captureBackend,elapsedMs:Date.now()-captureStarted,ageMs:Number.isFinite(frame.capturedAt)?Date.now()-frame.capturedAt:undefined});
   const captureStatus=JSON.stringify([frame.available,frame.foreground===true,diagnostic.reason??frame.reason??'',diagnostic.recognized,diagnostic.method]);
   if(captureStatus!==lastCaptureAvailable){lastCaptureAvailable=captureStatus;log.append({kind:'augment_capture_status',available:frame.ocrAvailable??frame.available,foreground:frame.foreground===true,reason:frame.reason??'',...diagnostic,captureBackend:frame.captureBackend,timings:frame.timings});}
   if(!frame.available)nextCaptureAt=Date.now()+60000;
   if(frame.focus!=='titles'&&!frame.panelOccluded){
    chatEmitted=0;
    chatObserver.observe(frame,lastLiveState);
    // 本地一行都没解析出来、但 OCR 确实读到聊天区有字：补读一次。
    if(!chatEmitted&&Number(frame.chatLines)>0)void maybeCorrectChat(frame);
   }
  }
 }catch(error){if(running){void captureReport({available:false,reason:'capture_failed',elapsedMs:Date.now()-captureStarted,message:String(error?.message??'')});if(lastCaptureAvailable!=='capture-error'){lastCaptureAvailable='capture-error';log.append({kind:'augment_capture_status',available:true,reason:'capture_failed'});}}}finally{capturing=false;}
},250);captureTimer.unref();
while(running){
 try{
  const credentials=readCredentials();
  if(credentials.ok){
   const result=await lcuRequest(credentials,'/lol-gameflow/v1/gameflow-phase');
   if(result.status===200&&result.data!==phase){phase=result.data;log.append({kind:'phase',phase});if(['ChampSelect','EndOfGame','Lobby','None'].includes(phase))nextMatch=true;}
   if(phase==='ChampSelect'){
    const selection=await readSelection(credentials);
    if(selection){
     if(!selectionLog){selectionMatch='select-'+Date.now();selectionLog=createEventLog(folder,selectionMatch);}
     selectionLog.append({kind:'champ_select',match:selectionMatch,...selection});
    }
   }else if(selectionLog){
    selectionLog.append({kind:'champ_select_end',match:selectionMatch,cancelled:['Lobby','None','EndOfGame'].includes(phase)});
    selectionLog=null;selectionMatch=null;
   }
  }
  const all=phase==='ChampSelect'?null:await getAllGameData(),state=compactState(all);
  lastLiveState=state;
  if(state){
   for(const player of [state.me,...state.allies,...state.enemies]){
    const name=championNames.get(String(player.championAlias??'').toLowerCase());if(name){player.championTitle=player.champion;player.champion=name;}
    player.items=(player.items??[]).map(enrichItem);
   }
   const time=all.gameData.gameTime;
   // 读数瞬断会把时钟打回 0：不能当新对局（实测 20:32 那局在 13:48 被拆成两个 match）。
   if(clockGlitch(time,gameTime)){if(!silenceEnded)lastDataAt=Date.now();await sleep(1000);continue;}
   if(startsNewMatch({time,previous:gameTime,nextMatch,sinceLastDataMs:Date.now()-lastDataAt})){
    nextMatch=false;lastDataAt=Date.now();silenceEnded=false;log=createEventLog(folder,'live-'+Date.now());lastEvent=-1;observer.reset();chatObserver.reset();ultimateObserver.reset();hudAssets.reset();captureSchedule.reset();captureGeneration++;lastCaptureAvailable=null;nextCaptureAt=0;
    log.append({kind:'game_start',me:state.me??{},queue:state.mode,gameTime:state.gameTime,allies:state.allies,enemies:state.enemies});
   }
   gameTime=time;lastDataAt=Date.now();silenceEnded=false;log.append(stateEvent(state));
   if(credentials.ok)void hudAssets.update({state,champions,match:log.file,source:credentials.port});
   if(credentials.ok)void readChatCatalog(credentials,acceptCatalog).catch(()=>{});
   const changed=diffEvents(lastEvent,all);lastEvent=changed.maxId;
   for(const e of changed.fresh)log.append({kind:'event',id:e.EventID,name:e.EventName,time:e.EventTime,killer:e.KillerName,victim:e.VictimName,turret:e.TurretKilled,dragon:e.DragonType,...e});
  }
 }catch{ /* Client can disappear between polling steps; no credential is logged. */ }
 // 静默结束：只有真的拿到过对局数据之后才判，避免开局前误判。
 if(lastLiveState&&shouldEndOnSilence({now:Date.now(),lastDataAt,threshold:silenceEndMs,ended:silenceEnded})){
  silenceEnded=true;
  try{for(const event of silenceEndEvents({silentForMs:Date.now()-lastDataAt,gameTime:lastLiveState?.gameTime??gameTime??null}))log.append(event);}catch{}
  nextMatch=true;gameTime=null;lastLiveState=null;
 }
 await sleep(lastLiveState?1000:3000);
}
clearInterval(captureTimer);captureStop.abort();captureWorker.close();
await hudAssets.close();
if(process.connected)process.disconnect();
