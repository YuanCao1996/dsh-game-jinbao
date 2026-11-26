// Opt-in collector prototype. Uses the bundled Node runtime; never starts DSH.
import {mkdir,readFile,open,lstat} from 'node:fs/promises';
import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {canonical,sha,rejected,normalizeCollectorRows,planCollectorUploads} from './collector-codec.mjs';
import {readCollectorArchive} from './collector-archive.mjs';
import {readCollectorSnapshot} from './collector-snapshot.mjs';
const GRANT='https://www.jinbaoai.top/desktop/node-agent/v1/collector/grant';
const SESSION='https://www.jinbaoai.top/desktop/node-agent/v1/collector/session';
const EVENTS='https://www.jinbaoai.top/desktop/node-agent/v1/collector/events';
const CONTEXT='https://www.jinbaoai.top/desktop/node-agent/v1/collector/context';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function officialFetch(url,options){
 if(![GRANT,SESSION,EVENTS,CONTEXT].includes(url))throw rejected();
 // Explicit TLS verification, no global proxy dispatcher, no redirect following.
 return new Promise((resolve,reject)=>{
  const request=httpsRequest(url,{method:'POST',headers:options.headers,signal:options.signal,timeout:8000,agent:false,rejectUnauthorized:true},response=>{
   if(!response.statusCode||response.statusCode<200||response.statusCode>=300){response.destroy();resolve(new Response(null,{status:response.statusCode??502}));return;}
   let size=0;const chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>4096){response.destroy();request.destroy();reject(transportError(502));}else chunks.push(chunk);});
   response.on('error',()=>reject(transportError(502)));
   response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:{'Content-Type':typeof response.headers['content-type']==='string'?response.headers['content-type']:''}})));
  });
  request.on('error',()=>reject(transportError()));request.on('timeout',()=>request.destroy());request.end(options.body);
 });
}
async function loadDevice(stateDir,collectorId){
 if(typeof collectorId!=='string'||!/^[a-f0-9]{64}$/.test(collectorId))throw rejected();
 const directory=join(stateDir,'node-collector'),file=join(directory,'device-'+collectorId+'.json');await mkdir(directory,{recursive:true});
 try{const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify({deviceId:randomUUID()}));await handle.sync();}finally{await handle.close();}}catch(error){if(error.code!=='EEXIST')throw error;}
 const stat=await lstat(file);if(stat.isSymbolicLink()||stat.size>200)throw rejected();
 const value=JSON.parse(await readFile(file,'utf8'));if(!uuid.test(value.deviceId))throw rejected();return value.deviceId;
}
function transportError(status){return Object.assign(Error('collector_transport_failed'),{status});}
async function post(fetchImpl,url,body,token,signal){
 const payload=canonical(body);if(Buffer.byteLength(payload)>30000)throw rejected();
 const response=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'jinbao-collector-preview/1.0'},body:payload});
 if(!response.ok){void response.body?.cancel().catch(()=>{});throw transportError(response.status);}
 if(!(response.headers.get('content-type')??'').toLowerCase().startsWith('application/json')){void response.body?.cancel().catch(()=>{});throw transportError(502);}
 const reader=response.body?.getReader();if(!reader)throw transportError(502);let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw transportError(502);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw transportError(502);}
}
export function createCollectorPreview({enabled=false,stateDir,getView,getMode,getToken,fetchImpl=officialFetch,now=Date.now,onStatus=()=>{}}={}){
 let closed=false,pending=null,active=null,identityCache=null,last={state:enabled?'waiting':'disabled'};
 const report=value=>{const changed=canonical(last)!==canonical(value);last=value;if(changed)try{onStatus(value);}catch{}return value;};
 const viewScope=()=>{
  const view=getView();if(getMode()!=='cloud'||!['lol','wzry','generic'].includes(view?.game)||typeof view.match!=='string'||!view.match||view.match==='waiting'||view.match.length>300||view.ended||view.phase==='CapturePaused'||!Number.isFinite(view.updatedAt)||now()-view.updatedAt>120000||view.updatedAt>now()+5000)return null;
  return {game:view.game,match:view.match,key:sha(view.game+':'+view.match)};
 };
 async function identity(){const scope=viewScope();if(!scope)return null;const token=await getToken();if(typeof token!=='string'||!/^jc_[a-f0-9]{64}$/.test(token))return null;return {...scope,login:token,account:sha(token),id:sha(token+':'+scope.key)};}
 const same=async scope=>{if(closed||scope.controller.signal.aborted)return false;return (await identity())?.id===scope.id;};
 async function run(scope){
  const turnSignal=AbortSignal.any([scope.controller.signal,AbortSignal.timeout(40000)]);
  const current=async()=>{if(!await same(scope))throw Object.assign(Error('collector_cancelled'),{cancelled:true});};
  try{
   const snapshot=await readCollectorSnapshot({stateDir,key:scope.key,game:scope.game,match:scope.match,now:now()});await current();
   const batch=await readCollectorArchive({stateDir,key:scope.key,account:scope.account,game:scope.game,match:scope.match});await current();
   if(!batch&&!snapshot)return report({state:'waiting'});
   const converted=batch?normalizeCollectorRows(batch.rows,scope.key):{events:[],issues:0},requests=planCollectorUploads(scope.key,converted.events);
   const syncSnapshot=snapshot&&snapshot.digest!==scope.snapshotDigest;
   if(requests.length||syncSnapshot){
    if(!scope.device){
     if(identityCache?.account!==scope.account){
      const found=await post(fetchImpl,SESSION,{action:'identity'},scope.login,turnSignal);await current();
      if(typeof found.collectorId!=='string'||!/^[a-f0-9]{64}$/.test(found.collectorId))throw rejected();
      identityCache={account:scope.account,collectorId:found.collectorId};
     }
     scope.device=await loadDevice(stateDir,identityCache.collectorId);await current();
    }
    const device=scope.device;
    if(!scope.registeredUntil||now()>=scope.registeredUntil-60000){
     const status=await post(fetchImpl,SESSION,{action:'status',deviceId:device},scope.login,turnSignal);await current();
     if(!Number.isSafeInteger(status.version)||status.version<0||status.version>=1000000||status.revoked===true)throw rejected();
     const opened=await post(fetchImpl,SESSION,{action:'open',deviceId:device,game:scope.game,matchKey:scope.key,expectedVersion:status.version},scope.login,turnSignal);await current();
     if(!Number.isSafeInteger(opened.version)||opened.version<1||opened.matchKey!==scope.key||!Number.isSafeInteger(opened.expiresAt)||opened.expiresAt<now()+1000||opened.expiresAt>now()+86400000)throw rejected();
     scope.registeredUntil=opened.expiresAt;scope.token=null;
    }
    if(!scope.token||now()>=scope.refreshAt){
     scope.token=null;const grant=await post(fetchImpl,GRANT,{deviceId:device,matchKey:scope.key},scope.login,turnSignal);await current();
     if(typeof grant.producerToken!=='string'||!grant.producerToken.startsWith('producer.'+device+'.')||!/^[A-Za-z0-9_-]{43}$/.test(grant.producerToken.slice(('producer.'+device+'.').length))||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<now()+1000||grant.expiresAt>now()+86400000)throw rejected();
     scope.token=grant.producerToken;scope.expiresAt=grant.expiresAt;scope.refreshAt=grant.expiresAt-Math.min(60000,Math.max(500,Math.floor((grant.expiresAt-now())/5)));
    }
    if(syncSnapshot){
     await current();if(now()>=scope.expiresAt)throw transportError(401);
     const revision=Math.max(now(),snapshot.packet.current_match_state.revision,(scope.snapshotRevision??0)+1);
     const body={packet:{...snapshot.packet,current_match_state:{...snapshot.packet.current_match_state,revision}}};
     const receipt=await post(fetchImpl,CONTEXT,body,scope.token,turnSignal);await current();
     if(receipt.accepted!==true||receipt.digest!==sha(canonical(body)))throw rejected();scope.snapshotDigest=snapshot.digest;scope.snapshotRevision=revision;
    }
    for(const request of requests){await current();if(now()>=scope.expiresAt)throw transportError(401);const receipt=await post(fetchImpl,EVENTS,request,scope.token,turnSignal);await current();if(receipt.accepted!==true||receipt.digest!==sha(canonical(request)))throw rejected();}
   }
   await current();if(batch?.advancedBytes)await batch.commit();
   if(requests.length||syncSnapshot)scope.lastSyncAt=now();
   scope.failures=0;scope.nextAt=now()+2000;
   return report({state:batch?.advancedBytes||syncSnapshot?'synced':'idle',converted:converted.events.length,issues:(batch?.issues??0)+converted.issues,requests:requests.length+(syncSnapshot?1:0)});
  }catch(error){
   if(error.cancelled||closed||scope.controller.signal.aborted){scope.token=null;return report({state:'cancelled'});}
   if(error.blocked||[400,404,409,413,415,422].includes(error.status)){scope.token=null;scope.blocked={state:'blocked',code:error.blocked?'collector_validation_failed':'collector_binding_rejected',...(Number.isInteger(error.status)?{httpStatus:error.status}:{})};return report(scope.blocked);}
   if([401,403].includes(error.status))scope.token=null;
   scope.failures=Math.min(scope.failures+1,6);scope.nextAt=now()+Math.min(60000,2000*2**(scope.failures-1));
   return report({state:'retry_wait',code:'collector_transport_unavailable',retryAt:scope.nextAt,...(Number.isInteger(error.status)?{httpStatus:error.status}:{})});
  }
 }
 return {
  status:()=>({...last}),
  async binding(game,match){
   const scope=active;
   if(!enabled||closed||!scope||scope.blocked||scope.game!==game||scope.match!==match||!scope.device||!scope.registeredUntil||scope.registeredUntil<=now()||!Number.isFinite(scope.lastSyncAt)||now()-scope.lastSyncAt>120000||!await same(scope)||active!==scope||closed)return null;
   return {deviceId:scope.device,matchKey:scope.key,game:scope.game,match:scope.match};
  },
  async tick(){
   if(closed||!enabled)return report({state:closed?'stopped':'disabled'});
   let found;try{found=await identity();}catch{return report({state:'waiting'});}
   if(closed)return report({state:'stopped'});
   if(active?.id!==found?.id){active?.controller.abort();if(pending)return report({state:'switching'});active=found?{...found,controller:new AbortController(),token:null,nextAt:0,failures:0,blocked:false}:null;}
   if(!active)return report({state:'waiting'});
   if(pending)return report({state:'busy'});
   if(active.blocked)return report(active.blocked);
   if(now()<active.nextAt)return report({state:'backoff',retryAt:active.nextAt});
   // Publish pending synchronously after identity checks, before run yields.
   const task=run(active);pending=task;try{return await task;}finally{if(pending===task)pending=null;}
  },
  async close(){closed=true;active?.controller.abort();if(active)active.token=null;await pending?.catch(()=>{});active=null;identityCache=null;return report({state:'stopped'});}
 };
}
