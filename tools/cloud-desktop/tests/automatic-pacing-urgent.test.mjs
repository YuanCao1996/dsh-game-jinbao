import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomaticPacing} from '../automatic-pacing.mjs';

test('a busy voice queue defers ordinary automatic work but never a confirmed-augment turn',async()=>{
 let busy=true,ran=0;
 const pacing=createAutomaticPacing({busy:()=>busy,intervalMs:0,now:()=>Date.now()});
 const ask=urgent=>pacing.run({topic:'advice',automatic:true,...(urgent?{urgent:true}:{})},async()=>{ran++;return 'ok';});

 assert.equal(pacing.canRequest(),false,'the coarse gate still reports blocked while busy');
 await assert.rejects(ask(false),e=>e.code==='auto_deferred'&&e.status===409);
 await pacing.run({topic:'equipment',automatic:true},async()=>'e').catch(()=>{});
 assert.equal(await ask(true),'ok','an urgent turn must not wait for the voice queue');
 assert.equal(ran,1);
});

test('urgency never allows two turns at once',async()=>{
 let release;
 const pacing=createAutomaticPacing({busy:()=>true,intervalMs:0});
 const first=pacing.run({topic:'advice',automatic:true,urgent:true},()=>new Promise(resolve=>{release=resolve;}));
 await new Promise(r=>setTimeout(r,10));
 await assert.rejects(pacing.run({topic:'advice',automatic:true,urgent:true},async()=>'second'),e=>e.code==='auto_deferred');
 release('first');
 assert.equal(await first,'first');
});

test('a manual request is never gated',async()=>{
 const pacing=createAutomaticPacing({busy:()=>true,intervalMs:60000});
 assert.equal(await pacing.run({topic:'chat',priority:'manual'},async()=>'answer'),'answer');
});

test('urgent 也豁免每主题间隔（20:25 六连拒的根因）',async()=>{
 const now=()=>t; let t=1000;
 const pacing=createAutomaticPacing({busy:()=>false,intervalMs:60000,now});
 assert.equal(await pacing.run({topic:'advice',automatic:true},async()=>'first'),'first');
 t+=1000;
 await assert.rejects(pacing.run({topic:'advice',automatic:true},async()=>'second'),e=>e.code==='auto_deferred','间隔内普通回合仍要被挡');
 assert.equal(await pacing.run({topic:'advice',automatic:true,urgent:true},async()=>'third'),'third','急事不能被 60 秒间隔挡住');
});

test('urgent 仍然不能并行',async()=>{
 let release; const pacing=createAutomaticPacing({busy:()=>false,intervalMs:0});
 const first=pacing.run({topic:'advice',automatic:true,urgent:true},()=>new Promise(r=>{release=r;}));
 await new Promise(r=>setTimeout(r,10));
 await assert.rejects(pacing.run({topic:'advice',automatic:true,urgent:true},async()=>'x'),e=>e.code==='auto_deferred');
 release('a'); assert.equal(await first,'a');
});
