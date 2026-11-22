import {readFile,writeFile,access,stat} from 'node:fs/promises';
import {join} from 'node:path';

// Recover a missing overlay, never kill a live process or restart the Agent.
export function createOverlaySupervisor({stateDir,launch,now=Date.now,
 read=async name=>{try{return JSON.parse(await readFile(join(stateDir,name),'utf8'));}catch{return null;}},
 stopped=async()=>{try{await access(join(stateDir,'overlay-stopped'));return true;}catch{return false;}},
 alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}},
 publish=value=>writeFile(join(stateDir,'overlay-health.json'),JSON.stringify(value),{mode:0o600})}){
 let closed=false,external=false,inFlight=null,lastAttempt=null,status='',attempts=[];
 const report=async(state,extra={})=>{if(status===state)return;status=state;await publish({state,at:now(),...extra}).catch(()=>{});};
 async function attempt(recover){
  lastAttempt=now();if(recover)attempts.push(lastAttempt);
  try{const result=await launch(recover);external=result?.external===true;await report(external?'external':'starting',{recovery:recover});}
  catch{await report('launch_failed');}
 }
 function run(action){
  if(closed||external)return Promise.resolve();if(inFlight)return inFlight;
  inFlight=(async()=>{if(!await stopped()&&!closed)await action();})().catch(()=>{}).finally(()=>{inFlight=null;});
  return inFlight;
 }
 return {
  start:()=>run(()=>attempt(false)),
  tick:()=>run(async()=>{
   // 悬浮窗每 5 秒写心跳；状态文件在更新但心跳停了，说明 UI 线程卡死，直接重拉。
   const beat=await read('overlay-heartbeat.json');
   const stateMtime=await stat(join(stateDir,'overlay-state.json')).then(info=>info.mtimeMs).catch(()=>0);
   if(beat&&Number.isSafeInteger(beat.pid)&&beat.pid>0&&alive(beat.pid)){
    const age=now()-Number(beat.at||0);
    if(age>20000&&stateMtime>Number(beat.at||0)+3000){
     try{process.kill(beat.pid);}catch{}
     await report('restarting_stale',{pid:beat.pid});
     if(!closed&&!await stopped())await attempt(true);
     return;
    }
   }
   const heartbeat=await read('overlay-capture-host.json');
   if(closed)return;
   if(heartbeat&&Number.isSafeInteger(heartbeat.pid)&&heartbeat.pid>0&&Number.isFinite(heartbeat.at)){
    if(await alive(heartbeat.pid)){
     await report(now()-heartbeat.at<10000?'healthy':'unresponsive');return;
    }
   }
   if(lastAttempt!==null&&now()-lastAttempt<15000)return;
   attempts=attempts.filter(at=>now()-at<60000);
   if(attempts.length>=3){await report('recovery_limited');return;}
   if(!closed&&!await stopped())await attempt(true);
  }),
  async close(){closed=true;await inFlight;},
 };
}
