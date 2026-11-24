// Dedicated audience endpoint. Never route through the player's Agent.
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const endpoint = 'https://api.jinbaoai.top/desktop/audience-agent/v1/tasks';
const fail = code => Object.assign(Error(code), {code});
const terminal = value => ['completed','cancelled','failed'].includes(value?.status);
const definitelyNotSubmitted = status => [400,401,403,404,405,409,413,429].includes(status);
async function json(response) {
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
    await response.body?.cancel();
    if(!response.ok&&definitelyNotSubmitted(response.status))
      throw Object.assign(fail('audience_service_unavailable'),{status:response.status,notSubmitted:true});
    throw fail('audience_invalid_response');
  }
  const reader=response.body?.getReader();
  if (!reader) throw fail('audience_invalid_response');
  let size=0;const parts=[];
  try {
    for (;;) {
      const part=await reader.read();if(part.done)break;
      size+=part.value.length;
      if(size>4096){await reader.cancel();throw fail('audience_response_budget');}
      parts.push(Buffer.from(part.value));
    }
  } finally {reader.releaseLock();}
  let value;
  try {value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail('audience_invalid_response');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('audience_invalid_response');
  if(!response.ok)throw Object.assign(fail('audience_service_unavailable'),{
    status:response.status,
    notSubmitted:definitelyNotSubmitted(response.status)
      ||response.status===503&&value.error==='audience_disabled'
      ||response.status===401&&value.error==='AUTH_REQUIRED',
  });
  return value;
}

export function createAudienceTaskAgent({enabled=false,getToken,fetchImpl=fetch,
  pollMs=750,timeoutMs=15000,cleanupMs=4000,pendingStore=null,stableIdentity=false,roomBindingEnabled=false}={}) {
  const lifetime=new AbortController();let busy=false,uncertain=false,settled=Promise.resolve(),roomBindingQueue=Promise.resolve();
  let pending=null,storageFailed=false;
  const account=token=>createHash('sha256').update(token).digest('hex');
  const ready=pendingStore?pendingStore.load().then(value=>{pending=value;uncertain=!!value;})
    .catch(()=>{storageFailed=true;uncertain=true;}):Promise.resolve();
  const persist=async value=>{
    try{if(pendingStore)await (value===null?pendingStore.clear():pendingStore.save(value));pending=value;}
    catch{storageFailed=true;uncertain=true;throw fail('audience_pending_unavailable');}
  };
  const call=async(body,token,signal)=>json(await fetchImpl(endpoint,{
    method:'POST',redirect:'error',cache:'no-store',
    signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),
  }));
  const stableAccount=async(token,signal)=>{
    const value=await call({action:'identity'},token,signal);
    if(!/^a1_[a-f0-9]{64}$/.test(value.account??''))throw fail('audience_identity_invalid');
    return value.account.slice(3);
  };
  return {
    scope:'public-audience-v1',
    status:()=>({enabled,busy,uncertain,...(roomBindingEnabled?{roomBindingEnabled:true}:{})}),
    configureRoom(roomId){
      const operation=roomBindingQueue.then(async()=>{
        await ready;
        if(!enabled||lifetime.signal.aborted)throw fail('audience_disabled');
        if(typeof roomId!=='string'||(roomId!==''&&!/^[1-9][0-9]{0,11}$/.test(roomId)))throw fail('audience_invalid_room');
        if(!roomBindingEnabled)return {configured:false,bound:false};
        const token=await getToken();
        if(typeof token!=='string'||!/^j[cdw]_[a-f0-9]{64}$/.test(token))throw fail('audience_login_required');
        const value=await call({action:'bind_room',roomId},token,lifetime.signal);
        if(value.bound!==true||value.roomId!==roomId)throw fail('audience_room_binding_failed');
        return {configured:true,bound:roomId!==''};
      });
      roomBindingQueue=operation.catch(()=>{});
      return operation;
    },
    async recover() {
      await ready;
      if(!enabled||lifetime.signal.aborted||busy||storageFailed)return {recovered:false};
      if(!pending)return {recovered:!uncertain};
      busy=true;let finish;settled=new Promise(resolve=>{finish=resolve;});
      try{
        const token=await getToken();
        if(typeof token!=='string'||!/^j[cdw]_[a-f0-9]{64}$/.test(token))return {recovered:false};
        const signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(cleanupMs)]);
        const owner=pending.identityKind==='account-v1'?await stableAccount(token,signal):account(token);
        if(owner!==pending.account||await getToken()!==token)return {recovered:false};
        let result=await call({action:'recover',roomId:pending.roomId,requestId:pending.requestId},token,signal);
        while(['queued','running'].includes(result.status)){
          await sleep(pollMs,undefined,{signal});
          result=await call({action:'recover',roomId:pending.roomId,requestId:pending.requestId},token,signal);
        }
        // Never replay an answer from a previous process into the current game.
        if(!terminal(result)&&result.status!=='not_submitted')return {recovered:false};
        if(await getToken()!==token)return {recovered:false};
        await persist(null);uncertain=false;return {recovered:true};
      }catch{return {recovered:false};}finally{busy=false;finish();}
    },
    async ask(request) {
      await ready;
      if(!enabled||lifetime.signal.aborted)throw fail('audience_disabled');
      if(storageFailed)throw fail('audience_pending_unavailable');
      if(uncertain)throw fail('audience_remote_state_unknown');
      if(busy)throw fail('audience_busy');
      if(!/^[1-9][0-9]{0,11}$/.test(request.roomId??'')
        ||!/^audience-[a-f0-9]{64}$/.test(request.sessionId??'')
        ||typeof request.question!=='string'||!request.question.trim()||request.question.length>200
        ||!['jinbao','liurufeng','wangbatian','tiezhi'].includes(request.role)
        ||!['lol','wzry','generic'].includes(request.context?.game))throw fail('audience_invalid_request');
      busy=true;let finish;settled=new Promise(resolve=>{finish=resolve;});
      const signals=[lifetime.signal,AbortSignal.timeout(timeoutMs)];if(request.signal)signals.push(request.signal);
      const signal=AbortSignal.any(signals);
      let token,taskId,submitted=false,done=false;
      const current=async()=>{
        signal.throwIfAborted();
        if(await getToken()!==token)throw fail('audience_login_changed');
        signal.throwIfAborted();
      };
      try {
        token=await getToken();
        if(typeof token!=='string'||!/^j[cdw]_[a-f0-9]{64}$/.test(token))throw fail('audience_login_required');
        await current();
        const owner=stableIdentity?await stableAccount(token,signal):account(token);
        await current();
        // Re-project even when called without the responder. Drop all client capabilities.
        const raw=request.context, text=(s,n=80)=>typeof s==='string'?s.slice(0,n):'';
        const names=rows=>Array.isArray(rows)?rows.slice(0,12).filter(x=>typeof x==='string').map(x=>text(x)):[];
        const context={game:raw.game,champion:text(raw.champion),mode:text(raw.mode),
          phase:text(raw.phase),gameTime:text(raw.gameTime,24),items:names(raw.items),
          augments:names(raw.augments),enemies:names(raw.enemies)};
        const requestId=randomUUID();
        await persist({account:owner,...(stableIdentity?{identityKind:'account-v1'}:{}),
          roomId:request.roomId,requestId,taskId:null});
        // Save before HTTP: a crash between send and response must not erase uncertainty.
        await current();submitted=true;
        const created=await call({action:'submit',roomId:request.roomId,matchId:request.sessionId,
          requestId,question:request.question,context,role:request.role},token,signal);
        if(!/^[a-f0-9]{32}$/.test(created.task_id??''))throw fail('audience_invalid_reference');
        taskId=created.task_id;
        await persist({...pending,taskId});
        for(;;) {
          await current();
          const result=await call({action:'poll',roomId:request.roomId,taskId},token,signal);
          await current();
          if(terminal(result)) {
            done=true;
            if(result.status!=='completed')throw fail('audience_task_incomplete');
            if(typeof result.result!=='string'||!result.result.trim()||result.result.length>180)
              throw fail('audience_invalid_answer');
            return {text:result.result.trim()};
          }
          if(!['queued','running'].includes(result.status))throw fail('audience_invalid_state');
          await sleep(pollMs,undefined,{signal});
        }
      } catch(error) {
        if(!taskId&&error.notSubmitted)submitted=false;
        throw error;
      } finally {
        // An HTTP failure can occur after the server accepted a submission.
        // No automatic resubmission or resetting this fence after a timer.
        if(submitted&&!done) {
          uncertain=true;
          if(taskId) {
            const cleanup=AbortSignal.timeout(cleanupMs);
            try {
              let result=await call({action:'cancel',roomId:request.roomId,taskId},token,cleanup);
              while(!terminal(result)) {
                if(!['queued','running'].includes(result.status))throw fail('audience_invalid_state');
                await sleep(pollMs,undefined,{signal:cleanup});
                result=await call({action:'poll',roomId:request.roomId,taskId},token,cleanup);
              }
              await persist(null);uncertain=false;
            }catch{/* Keep the fence until remote state is reconciled externally. */}
          }
        }
        if(!submitted||done){try{await persist(null);if(!storageFailed)uncertain=false;}catch{}}
        busy=false;finish();
      }
    },
    async close(){lifetime.abort();await settled;},
  };
}
