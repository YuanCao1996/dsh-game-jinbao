import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createAudiencePendingStore} from '../audience-pending.mjs';
import {createAudienceTaskAgent} from '../audience-task-agent.mjs';

const token='jc_'+'a'.repeat(64),account=createHash('sha256').update(token).digest('hex');
const pending=()=>({account,roomId:'2948407',requestId:randomUUID(),taskId:null});
const request={roomId:'2948407',sessionId:'audience-'+'c'.repeat(64),question:'PRIVATE_QUESTION',
  role:'jinbao',context:{game:'lol',memory:'PRIVATE_CONTEXT'}};
async function fixture(options={}){
 const dir=await mkdtemp(join(tmpdir(),'jinbao-audience-recover-'));
 const store=createAudiencePendingStore(dir);
 const make=extra=>createAudienceTaskAgent({enabled:true,pendingStore:createAudiencePendingStore(dir),
   getToken:async()=>token,pollMs:1,cleanupMs:30,...options,...extra});
 return {dir,store,make};
}
test('pending references survive restart without saving token, question or context',async()=>{
 const {dir,store,make}=await fixture();let seen;
 const agent=make({fetchImpl:async()=>{
   seen=await store.load();throw Error('lost_response');
 }});
 await assert.rejects(agent.ask(request),/lost_response/);await agent.close();
 assert.match(seen.requestId,/^[a-f0-9-]{36}$/);assert.equal(seen.taskId,null);
 const disk=await readFile(join(dir,'audience-pending.json'),'utf8');
 assert.doesNotMatch(disk,/PRIVATE|jc_|question|context/i);
 const restored=make({fetchImpl:async()=>{throw Error('must_not_submit');}});
 await assert.rejects(restored.ask(request),/audience_remote_state_unknown/);
 await restored.close();
});
test('recovery confirms no submission then clears marker without replaying a question',async()=>{
 const {store,make}=await fixture();const original=pending();await store.save(original);
 const actions=[];const agent=make({fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);actions.push(body);
   return Response.json({status:'not_submitted',result:null,error:null});
 }});
 assert.deepEqual(await agent.recover(),{recovered:true});
 assert.equal(await store.load(),null);assert.equal(agent.status().uncertain,false);
 assert.deepEqual(actions,[{action:'recover',roomId:original.roomId,requestId:original.requestId}]);
 await agent.close();
});
test('recovery cancels old running task and discards its eventual answer',async()=>{
 const {store,make}=await fixture();await store.save({...pending(),taskId:'b'.repeat(32)});
 let calls=0;const agent=make({fetchImpl:async()=>Response.json(++calls===1?
   {status:'running'}:{status:'completed',result:'OLD_ANSWER'})});
 assert.deepEqual(await agent.recover(),{recovered:true});assert.equal(calls,2);
 assert.equal(await store.load(),null);await agent.close();
});
test('another login cannot recover or erase the saved account reference',async()=>{
 const {store,make}=await fixture();const record=pending();await store.save(record);let calls=0;
 const agent=make({getToken:async()=>'jc_'+'d'.repeat(64),fetchImpl:async()=>{calls++;throw Error();}});
 assert.deepEqual(await agent.recover(),{recovered:false});assert.equal(calls,0);
 assert.deepEqual(await store.load(),record);await agent.close();
});
test('unknown server state and network errors retain durable fence',async()=>{
 for(const mode of ['unknown','offline']){
   const {store,make}=await fixture();const record=pending();await store.save(record);
   const agent=make({fetchImpl:async()=>{if(mode==='offline')throw Error();return Response.json({status:'unknown'});}});
   assert.deepEqual(await agent.recover(),{recovered:false});
   assert.deepEqual(await store.load(),record);
   await assert.rejects(agent.ask(request),/audience_remote_state_unknown/);await agent.close();
 }
});
test('corrupt pending file fails closed rather than silently becoming an empty queue',async()=>{
 const {dir,make}=await fixture();await writeFile(join(dir,'audience-pending.json'),'broken');
 let calls=0;const agent=make({fetchImpl:async()=>{calls++;throw Error();}});
 await assert.rejects(agent.ask(request),/audience_pending_unavailable/);
 assert.deepEqual(await agent.recover(),{recovered:false});assert.equal(calls,0);await agent.close();
});
test('storage write failure prevents the HTTP submission',async()=>{
 let calls=0;const agent=createAudienceTaskAgent({enabled:true,getToken:async()=>token,
  pendingStore:{load:async()=>null,save:async()=>{throw Error('disk_full');},clear:async()=>{}},
  fetchImpl:async()=>{calls++;throw Error();}});
 await assert.rejects(agent.ask(request),/audience_pending_unavailable/);assert.equal(calls,0);
 await assert.rejects(agent.ask(request),/audience_pending_unavailable/);await agent.close();
});

test('stable authenticated identity recovers after renewing the login token',async()=>{
 const {store,make}=await fixture();const stable='a1_'+'f'.repeat(64);
 const first=make({stableIdentity:true,fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);
   if(body.action==='identity')return Response.json({account:stable});
   throw Error('lost_response');
 }});
 await assert.rejects(first.ask(request),/lost_response/);await first.close();
 const saved=await store.load();assert.equal(saved.identityKind,'account-v1');assert.equal(saved.account,stable.slice(3));
 const actions=[];const renewed=make({stableIdentity:true,getToken:async()=>'jc_'+'e'.repeat(64),
   fetchImpl:async(_url,options)=>{
     const body=JSON.parse(options.body);actions.push(body.action);
     return Response.json(body.action==='identity'?{account:stable}:{status:'not_submitted'});
   }});
 assert.deepEqual(await renewed.recover(),{recovered:true});assert.equal(await store.load(),null);
 assert.deepEqual(actions,['identity','recover']);await renewed.close();
});
test('a different stable account cannot clear the old pending task',async()=>{
 const {store,make}=await fixture();const record={...pending(),identityKind:'account-v1'};await store.save(record);
 const actions=[];const agent=make({stableIdentity:true,fetchImpl:async(_url,options)=>{
   actions.push(JSON.parse(options.body).action);return Response.json({account:'a1_'+'f'.repeat(64)});
 }});
 assert.deepEqual(await agent.recover(),{recovered:false});assert.deepEqual(actions,['identity']);
 assert.deepEqual(await store.load(),record);await agent.close();
});
