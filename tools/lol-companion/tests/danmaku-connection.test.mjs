import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createBilibiliDanmaku,packFrame,parseFrames,OP} from '../danmaku-bridge.mjs';

function harness(extra={}){
 const sockets=[],states=[],messages=[];
 class Socket{
  constructor(url){this.url=url;sockets.push(this);this.sent=[];}
  send(frame){this.sent.push(frame);}
  close(){this.closed=true;this.onclose?.();}
 }
 const fetchImpl=async url=>({json:async()=>url.includes('/spi')?{data:{b_3:'fixture'}}:url.includes('room_init')?{data:{room_id:123}}:url.includes('/nav')?{data:{wbi_img:{img_url:'https://fixture/'+ 'a'.repeat(32)+'.png',sub_url:'https://fixture/'+ 'b'.repeat(32)+'.png'}}}:{data:{token:'fixture-token',host_list:[{host:'fixture.chat.bilibili.com',wss_port:2245}]}}});
 const bridge=createBilibiliDanmaku({roomId:'123',fetchImpl,WsImpl:Socket,onStatus:s=>states.push(s.state),onMessage:m=>messages.push(m),reconnectMs:5,timeoutMs:200,...extra});
 return {bridge,sockets,states,messages};
}
const auth=(socket,code=0)=>socket.onmessage({data:packFrame(OP.AUTH_REPLY,JSON.stringify({code}))});
async function until(check){for(let i=0;i<100;i++){if(check())return;await delay(3);}assert.fail('condition timed out');}

test('authentication rejection never reports ready and retries without stale callbacks',async()=>{
 const h=harness();try{
  await h.bridge.start();const first=h.sockets[0];first.onopen();assert.equal(first.url,'wss://fixture.chat.bilibili.com:2245/sub');const sent=JSON.parse(parseFrames(first.sent[0])[0].text);assert.equal(sent.buvid,'fixture');assert.equal(sent.protover,3);const oldClose=first.onclose;
  auth(first,-101);assert.equal(h.states.includes('authorized'),false);
  await until(()=>h.sockets.length===2);const second=h.sockets[1];second.onopen();auth(second);
  oldClose();assert.equal(h.bridge.status().state,'authorized');assert.equal(first.closed,true);
 }finally{h.bridge.stop();}
});
test('disconnect automatically reconnects and authorized messages reach callback',async()=>{
 const h=harness();try{
  await h.bridge.start();const first=h.sockets[0];first.onopen();auth(first);first.onerror();
  await until(()=>h.sockets.length===2);const second=h.sockets[1];second.onopen();auth(second);
  second.onmessage({data:packFrame(OP.MESSAGE,JSON.stringify({cmd:'DANMU_MSG',info:[[],'@金宝 下一件出什么',[1,'fixture']]}))});
  assert.equal(h.messages.length,1);assert.equal(h.bridge.status().state,'authorized');
 }finally{h.bridge.stop();}
});
test('stop cancels pending reconnect and cannot reopen after delayed HTTP result',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const h=harness({fetchImpl:async()=>{await pending;return {json:async()=>({data:{b_3:'fixture'}})};}});
 const started=h.bridge.start();h.bridge.stop();resolve();await started;await delay(15);
 assert.equal(h.sockets.length,0);assert.equal(h.bridge.status().state,'closed');
 const other=harness();await other.bridge.start();other.sockets[0].onerror();other.bridge.stop();await delay(20);
 assert.equal(other.sockets.length,1);assert.equal(other.bridge.status().state,'closed');
});
test('silent WebSocket authentication times out and repeated start does not duplicate sockets',async()=>{
 const h=harness({timeoutMs:15});try{
  await h.bridge.start();await h.bridge.start();assert.equal(h.sockets.length,1);
  await until(()=>h.sockets.length>=2);assert.ok(h.states.includes('reconnecting'));
 }finally{h.bridge.stop();}
});
