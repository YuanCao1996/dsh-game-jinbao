import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudienceResponder,publicAudienceContext} from '../audience-agent.mjs';

test('public projection strips private chat, account fields, images and memory',()=>{
 const value=publicAudienceContext({game:'lol',selfChampion:'安妮',viewerFacts:{items:['帽子'],enemies:[{champion:'布隆',name:'PRIVATE'},{name:'PRIVATE'}]},chat:[{text:'PRIVATE'}],userMemory:{secret:'PRIVATE'},email:'PRIVATE',screenshot:'PRIVATE'});
 assert.doesNotMatch(JSON.stringify(value),/PRIVATE/);assert.deepEqual(value.enemies,['布隆']);
 assert.throws(()=>createAudienceResponder({agent:{ask(){}}}),/scope_required/);
});
test('a timed-out non-cooperative task holds the slot until its actual completion',async()=>{
 let time=0,resolve,calls=0;
 const responder=createAudienceResponder({now:()=>time,timeoutMs:5,agent:{scope:'public-audience-v1',ask:()=>{calls++;return new Promise(done=>{resolve=done;});}}});responder.bind('one');
 await responder.reply('第一个问题');assert.equal(responder.status().held,true);time=60000;
 assert.equal((await responder.reply('第二个问题')).reason,'audience_rate_limited');assert.equal(calls,1);
 resolve({text:'late answer'});await Promise.resolve();await Promise.resolve();
 assert.equal(responder.status().held,false);responder.close();
});
test('greetings do not consume requests; actual agent receives only public context and isolated session',async()=>{
 let calls=0,packet;const responder=createAudienceResponder({agent:{scope:'public-audience-v1',ask:async request=>{calls++;packet=request;return {text:'先跟队友打控制。'};}}});responder.bind('2948407');
 assert.equal((await responder.reply('@金宝 你好呀')).source,'local');assert.equal(calls,0);
 const result=await responder.reply('这个英雄怎么玩',{game:'lol',match:'round-one',selfChampion:'安妮',chat:['PRIVATE'],profile:'PRIVATE'});
 assert.equal(result.source,'agent');assert.match(packet.sessionId,/^audience-/);assert.doesNotMatch(JSON.stringify(packet),/PRIVATE/);
 assert.equal((await responder.reply('第二个问题')).reason,'audience_rate_limited');assert.equal(calls,1);responder.close();
});
test('room switch aborts pending work and never publishes its late result',async()=>{
 let resolve;const responder=createAudienceResponder({agent:{scope:'public-audience-v1',ask:()=>new Promise(done=>{resolve=done;})}});responder.bind('one');
 const pending=responder.reply('这个英雄怎么玩');await Promise.resolve();responder.bind('two');
 assert.equal(await pending,null);resolve({text:'old room answer'});responder.close();
});
test('timeout makes one call and falls back without retry; hourly budget is independent of cooldown',async()=>{
 let time=0,calls=0;const responder=createAudienceResponder({now:()=>time,timeoutMs:5,maxPerHour:1,agent:{scope:'public-audience-v1',ask:async()=>{calls++;return new Promise(()=>{});}}});responder.bind('one');
 assert.equal((await responder.reply('这个英雄怎么玩')).reason,'audience_agent_failed');time=60000;
 assert.equal((await responder.reply('另一个问题')).reason,'audience_rate_limited');assert.equal(calls,1);responder.close();
});
