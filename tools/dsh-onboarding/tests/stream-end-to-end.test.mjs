import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSetupServer} from '../server.mjs';

test('authenticated stream settings and actual receive callback persist and render audience reply',async t=>{
 const stateDir=await mkdtemp(join(tmpdir(),'jinbao-stream-e2e-'));let callbacks,stopped=false;
 const server=await createSetupServer({stateDir,port:0,credentials:{resolve:async()=>null,set:async()=>{}},
  fetchImpl:async()=>Response.json({}),danmakuFactory:options=>{
   callbacks=options;return {start:async()=>options.onStatus({state:'authorized'}),stop:()=>{stopped=true;options.onStatus({state:'closed'});}};
  }});
 t.after(server.close);
 const [base,nonce]=server.url.split('/#');
 const call=async(value)=>{const response=await fetch(base+'/api/stream',{method:value?'POST':'GET',headers:{'Content-Type':'application/json','X-Jinbao-Setup':nonce},...(value?{body:JSON.stringify(value)}:{})});assert.equal(response.status,200);return response.json();};
 await call({enabled:true,roomId:'2948407',trigger:'all',reply:true});
 await callbacks.onMessage({platform:'bilibili',user:'测试观众',uid:1,text:'@金宝 下一件出什么'});
 const status=await call();assert.equal(status.status,'authorized');
 assert.deepEqual([status.metrics.received,status.metrics.accepted,status.metrics.replied,status.metrics.logErrors],[1,1,1,0]);
 const message=JSON.parse((await readFile(join(stateDir,'logs/viewer.jsonl'),'utf8')).trim());
 const reply=JSON.parse((await readFile(join(stateDir,'logs/coach_broadcasts.jsonl'),'utf8')).trim());
 assert.equal(message.viewerMessageId,reply.viewerMessageId);assert.equal(reply.noSpeech,true);
 for(let i=0;i<150&&!server.view().chat.includes('回应观众');i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.match(server.view().chat,/观众 · 测试观众/);assert.match(server.view().chat,/回应观众/);
 await server.close();assert.equal(stopped,true);
});
