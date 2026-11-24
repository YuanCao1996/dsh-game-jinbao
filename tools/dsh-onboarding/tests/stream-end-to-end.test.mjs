import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSetupServer} from '../server.mjs';
import {createAudienceTaskAgent} from '../../cloud-desktop/audience-task-agent.mjs';

test('authenticated stream settings and actual receive callback persist and render audience reply',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'jinbao-stream-e2e-'));let callbacks,stopped=false,agentRequest;
 const actions=[],bindings=[];
 const audienceAgent=createAudienceTaskAgent({enabled:true,roomBindingEnabled:true,getToken:async()=>'jc_'+'a'.repeat(64),
  fetchImpl:async(url,options)=>{
   assert.equal(url,'https://api.jinbaoai.top/desktop/audience-agent/v1/tasks');
   const body=JSON.parse(options.body);actions.push(body.action);
   if(body.action==='bind_room'){bindings.push(body.roomId);return Response.json({bound:true,roomId:body.roomId});}
   if(body.action==='submit'){agentRequest=body;return Response.json({task_id:'b'.repeat(32),created:true},{status:202});}
   return Response.json({status:'completed',result:'先等队友控制再配合。',error:null});
  }});
 const server=await createSetupServer({stateDir,port:0,credentials:{resolve:async()=>null,set:async()=>{}},
  fetchImpl:async()=>Response.json({}),audienceAgent,speech:{role:()=> 'liurufeng'},danmakuFactory:options=>{
   callbacks=options;return {start:async()=>options.onStatus({state:'authorized'}),stop:()=>{stopped=true;options.onStatus({state:'closed'});}};
  }});
 t.after(server.close);
 const [base,nonce]=server.url.split('/#');
 const call=async(value)=>{const response=await fetch(base+'/api/stream',{method:value?'POST':'GET',headers:{'Content-Type':'application/json','X-Jinbao-Setup':nonce},...(value?{body:JSON.stringify(value)}:{})});assert.equal(response.status,200);return response.json();};
 await call({enabled:true,roomId:'2948407',trigger:'all',reply:true});
 let status;for(let i=0;i<40;i++){status=await call();if(status.audienceAgent.roomConfigured===true)break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(status.audienceAgent.roomConfigured,true);
 await callbacks.onMessage({platform:'bilibili',user:'测试观众',uid:1,text:'@金宝 下一件出什么'});
 status=await call();assert.equal(status.status,'authorized');
 assert.equal(status.audienceAgent.configured,true);assert.match(agentRequest.matchId,/^audience-/);
 assert.equal(agentRequest.roomId,'2948407');assert.equal(agentRequest.role,'liurufeng');
 assert.deepEqual(actions,['bind_room','submit','poll']);
 assert.equal(status.metrics.lastReplySource,'agent');
 const unauthenticated=await fetch(base+'/api/stream/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(unauthenticated.status,403);
 const recovered=await fetch(base+'/api/stream/recover',{method:'POST',headers:{'Content-Type':'application/json','X-Jinbao-Setup':nonce},body:'{}'});
 assert.deepEqual(await recovered.json(),{recovered:true});
 assert.deepEqual(actions,['bind_room','submit','poll'],'local recovery with no pending task never creates a new model request');
 const forged=await fetch(base+'/api/stream/recover',{method:'POST',headers:{'Content-Type':'application/json','X-Jinbao-Setup':nonce},body:JSON.stringify({owner:'other'})});
 assert.equal(forged.status,400);
 assert.deepEqual([status.metrics.received,status.metrics.accepted,status.metrics.replied,status.metrics.logErrors],[1,1,1,0]);
 const message=JSON.parse((await readFile(join(stateDir,'logs/viewer.jsonl'),'utf8')).trim());
 const reply=JSON.parse((await readFile(join(stateDir,'logs/coach_broadcasts.jsonl'),'utf8')).trim());
 assert.equal(message.viewerMessageId,reply.viewerMessageId);assert.equal(reply.noSpeech,true);
 assert.equal(reply.broadcast,'先等队友控制再配合。');
 for(let i=0;i<150&&!server.view().chat.includes('回应观众');i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.match(server.view().chat,/观众 · 测试观众/);assert.match(server.view().chat,/回应观众/);
 await call({enabled:false});
 assert.deepEqual(bindings,['2948407','']);assert.equal(actions.at(-1),'bind_room');
 assert.equal(stopped,true,'disabling streamer mode stops the live bridge');
 await server.close();assert.equal(stopped,true);
 await assert.rejects(audienceAgent.ask({}),/audience_disabled/);
});
