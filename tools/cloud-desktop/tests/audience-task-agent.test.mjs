import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudienceTaskAgent} from '../audience-task-agent.mjs';
import {createAudienceResponder} from '../../lol-companion/audience-agent.mjs';

const token='jc_'+'a'.repeat(64), taskId='b'.repeat(32);
const request=()=>({roomId:'2948407',sessionId:'audience-'+'c'.repeat(64),
  question:'下一件出什么？',role:'jinbao',context:{game:'lol',mode:'KIWI',champion:'安妮',
    memory:'PRIVATE',conversation:['PRIVATE'],capabilities:{screens:true}}});
function make(options={}) {
  const calls=[];
  const agent=createAudienceTaskAgent({enabled:true,getToken:async()=>token,pollMs:1,cleanupMs:50,
    fetchImpl:async(url,opts)=>{
      assert.equal(url,'https://api.jinbaoai.top/desktop/audience-agent/v1/tasks');
      assert.equal(opts.redirect,'error');assert.match(opts.headers.Authorization,/^Bearer j[cdw]_[a-f0-9]{64}$/);
      const body=JSON.parse(opts.body);calls.push(body);
      return Response.json(body.action==='bind_room'?{bound:true,roomId:body.roomId}:
        body.action==='submit'?{task_id:taskId,created:true}:
        {status:'completed',result:'先等队友控制。',error:null});
    },...options});
  return {agent,calls};
}

test('dedicated submit/poll transport returns final text and reprojects context',async()=>{
  const {agent,calls}=make();
  assert.equal(agent.scope,'public-audience-v1');
  assert.deepEqual(await agent.ask(request()),{text:'先等队友控制。'});
  assert.deepEqual(calls.map(x=>x.action),['submit','poll']);
  assert.doesNotMatch(JSON.stringify(calls),/PRIVATE|capabilities/);
  assert.equal(calls[0].context.mode,'KIWI');assert.match(calls[0].requestId,/^[a-f0-9-]{36}$/);
  await agent.close();
});
test('disabled agent and invalid login make no network requests',async()=>{
  const {agent,calls}=make({enabled:false});await assert.rejects(agent.ask(request()),/audience_disabled/);
  assert.equal(calls.length,0);await agent.close();
  const other=make({getToken:async()=>null});
  await assert.rejects(other.agent.ask(request()),/audience_login_required/);
  assert.equal(other.calls.length,0);await other.agent.close();
});
test('verified room binding gates audience asks and accepts all desktop token namespaces',async()=>{
  const {agent,calls}=make({roomBindingEnabled:true,getToken:async()=> 'jw_'+'e'.repeat(64)});
  const responder=createAudienceResponder({agent});responder.bind('2948407');
  const view={game:'lol',match:'match-1',selfChampion:'安妮'};
  const blocked=await responder.reply('下一件出什么？',view);
  assert.equal(blocked.reason,'audience_room_unverified');assert.equal(calls.length,0);
  assert.deepEqual(await responder.configureRoom('2948407'),{configured:true});
  assert.deepEqual(calls[0],{action:'bind_room',roomId:'2948407'});
  const answer=await responder.reply('下一件出什么？',view);
  assert.equal(answer.source,'agent');assert.deepEqual(calls.map(x=>x.action),['bind_room','submit','poll']);
  responder.close();await agent.close();
});
test('room bindings are serialized so a delayed old room cannot overwrite the latest room',async()=>{
 let active=0,maxActive=0;const order=[];
 const {agent}=make({roomBindingEnabled:true,fetchImpl:async(_url,opts)=>{
  const body=JSON.parse(opts.body);order.push(body.roomId);active++;maxActive=Math.max(maxActive,active);
  if(body.roomId==='2948407')await new Promise(resolve=>setTimeout(resolve,15));
  active--;return Response.json({bound:true,roomId:body.roomId});
 }});
 const first=agent.configureRoom('2948407'),second=agent.configureRoom('6650029');
 await Promise.all([first,second]);
 assert.deepEqual(order,['2948407','6650029']);assert.equal(maxActive,1);
 await agent.close();
});
test('lost submission is not retried and fences later questions',async()=>{
  let count=0;
  const {agent}=make({fetchImpl:async()=>{count++;throw Error('network_lost');}});
  await assert.rejects(agent.ask(request()),/network_lost/);
  assert.equal(agent.status().uncertain,true);
  await assert.rejects(agent.ask(request()),/audience_remote_state_unknown/);
  assert.equal(count,1);await agent.close();
});
test('explicit disabled response never pretends a task was accepted',async()=>{
  let calls=0;
  const {agent}=make({fetchImpl:async()=>{calls++;return Response.json({error:'audience_disabled'},{status:503});}});
  await assert.rejects(agent.ask(request()),/audience_service_unavailable/);
  assert.equal(agent.status().uncertain,false);
  await assert.rejects(agent.ask(request()),/audience_service_unavailable/);
  assert.equal(calls,2);await agent.close();
});
test('explicit pre-submit authorization refusal clears the marker without fencing the next question',async()=>{
  let rejected=true;const actions=[];
  const {agent}=make({fetchImpl:async(_url,opts)=>{
    const body=JSON.parse(opts.body);actions.push(body.action);
    if(body.action==='submit'&&rejected){rejected=false;return Response.json({error:'audience_service_unavailable'},{status:403});}
    return Response.json(body.action==='submit'?{task_id:taskId,created:true}:
      {status:'completed',result:'可以继续提问。'});
  }});
  await assert.rejects(agent.ask(request()),/audience_service_unavailable/);
  assert.equal(agent.status().uncertain,false);
  assert.deepEqual(await agent.ask(request()),{text:'可以继续提问。'});
  assert.deepEqual(actions,['submit','submit','poll']);await agent.close();
});
test('HTML proxy 404 and 413 responses are known pre-submit failures',async()=>{
  for(const status of [404,413]){
    const {agent}=make({fetchImpl:async()=>new Response('<html>rejected</html>',{
      status,headers:{'content-type':'text/html'},
    })});
    await assert.rejects(agent.ask(request()),/audience_service_unavailable/);
    assert.equal(agent.status().uncertain,false);await agent.close();
  }
});
test('abort cancels remote task and confirms terminal status before freeing slot',async()=>{
  const controller=new AbortController(),actions=[];
  const {agent}=make({fetchImpl:async(_url,opts)=>{
    const body=JSON.parse(opts.body);actions.push(body.action);
    if(body.action==='submit')return Response.json({task_id:taskId});
    if(body.action==='poll'&&actions.length===2){controller.abort();throw Error('aborted');}
    return Response.json(body.action==='cancel'?{status:'running'}:{status:'cancelled'});
  }});
  await assert.rejects(agent.ask({...request(),signal:controller.signal}));
  assert.deepEqual(actions,['submit','poll','cancel','poll']);
  assert.deepEqual(agent.status(),{enabled:true,busy:false,uncertain:false});await agent.close();
});
test('unconfirmed cancellation holds remote uncertainty fence',async()=>{
  const {agent}=make({fetchImpl:async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    if(body.action==='submit')return Response.json({task_id:taskId});
    throw Error('offline');
  }});
  await assert.rejects(agent.ask(request()),/offline/);
  assert.equal(agent.status().uncertain,true);await agent.close();
});
test('account switch never returns the old account answer and cancels with captured token',async()=>{
  let currentToken=token;const actions=[];
  const {agent}=make({getToken:async()=>currentToken,
    fetchImpl:async(_url,opts)=>{
      assert.equal(opts.headers.Authorization,'Bearer '+token);
      const body=JSON.parse(opts.body);actions.push(body.action);
      if(body.action==='submit')currentToken='jc_'+'d'.repeat(64);
      return Response.json(body.action==='submit'?{task_id:taskId}:{status:'cancelled'});
    }});
  await assert.rejects(agent.ask(request()),/audience_login_changed/);
  assert.deepEqual(actions,['submit','cancel']);assert.equal(agent.status().uncertain,false);await agent.close();
});
test('malformed and oversized responses cannot become audience replies',async()=>{
  for(const value of ['not-json','x'.repeat(5000)]) {
    const {agent}=make({fetchImpl:async()=>new Response(value,{headers:{'content-type':'application/json'}})});
    await assert.rejects(agent.ask(request()),/audience_(invalid_response|response_budget)/);
    assert.equal(agent.status().uncertain,true);await agent.close();
  }
});
test('failed task is terminal and never turns into an answer',async()=>{
  const actions=[];
  const {agent}=make({fetchImpl:async(_url,opts)=>{
    const body=JSON.parse(opts.body);actions.push(body.action);
    return Response.json(body.action==='submit'?{task_id:taskId}:{status:'failed',error:'internal_details'});
  }});
  await assert.rejects(agent.ask(request()),/audience_task_incomplete/);
  assert.equal(agent.status().uncertain,false);assert.deepEqual(actions,['submit','poll']);await agent.close();
});
test('responder binds numeric room and sends only public data to actual transport',async()=>{
  const {agent,calls}=make();const responder=createAudienceResponder({agent});
  responder.bind('2948407');
  const value=await responder.reply('下一件出什么？',{game:'lol',match:'match-1',mode:'KIWI',
    selfChampion:'安妮',profile:'PRIVATE',viewerFacts:{items:['残疫']}});
  assert.equal(value.source,'agent');assert.equal(calls[0].roomId,'2948407');
  assert.match(calls[0].matchId,/^audience-[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(calls),/PRIVATE/);
  responder.close();await agent.close();
});
