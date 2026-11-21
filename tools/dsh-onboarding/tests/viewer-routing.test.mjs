import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayRouter,overlayView,createOverlayService} from '../overlay-state.mjs';
import {viewerReply} from '../../lol-companion/viewer-reply.mjs';
import {mkdtemp,mkdir,writeFile,appendFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function fixture(){
 const router=createOverlayRouter(),now=Date.now();
 router.apply({game:'lol',t:now,kind:'game_start',me:{champion:'安妮'}},'match.jsonl');
 const state=router.state();
 return {router,state,now,message:{game:'lol',match:state.match,t:now+1,kind:'viewer_message',viewerMessageId:'test-one',user:'测试观众',text:'@金宝 下一件出什么'}};
}
test('audience input routes to active match without becoming an observation',()=>{
 const {router,state,now,message}=fixture();
 assert.equal(router.apply(message,'viewer.jsonl'),undefined);
 assert.equal(router.state(),state);assert.equal(state.at,now);
 assert.equal(state.chat.length,1);assert.equal(state.chat[0].origin,'viewer');
 router.apply(message,'viewer.jsonl');assert.equal(state.chat.length,1);
 const view=overlayView(state);
 assert.match(view.chat,/观众 · 测试观众/);assert.equal(view.chatRows[0].origin,'viewer');
});
test('audience reply appears once in battle thread and stays silent in playback',()=>{
 const {router,state,message}=fixture();router.apply(message,'viewer.jsonl');
 const reply={...message,t:message.t+1,kind:'viewer_reply',broadcast:'先看对面阵容。',noSpeech:true};
 router.apply(reply,'coach_broadcasts.jsonl');router.apply(reply,'coach_broadcasts.jsonl');
 const view=overlayView(state);
 assert.equal(state.chat.length,2);assert.equal(state.broadcasts.length,1);
 assert.equal(view.thread.filter(row=>row.text.includes('先看对面阵容')).length,1);
 assert.equal(view.playback.find(row=>row.text.includes('先看对面阵容')).noSpeech,true);
 assert.match(view.chat,/金宝 · 回应观众/);
});
test('late audience records cannot cross match or game boundaries',()=>{
 const {router,state,message}=fixture();
 for(const altered of [{...message,match:'old-match'},{...message,game:'wzry'},{...message,t:state.matchStartedAt-1}])router.apply(altered,'viewer.jsonl');
 assert.equal(state.chat.length,0);assert.equal(router.state(),state);
});
test('viewer facts expose champion data without player identity and unknown gold stays unknown',()=>{
 const {state}=fixture();state.ownedAugments=['已确认强化'];state.enemies=[{champion:'布隆',riotId:'private-player'}];
 const facts=overlayView(state).viewerFacts;
 assert.deepEqual(facts.augments,['已确认强化']);assert.deepEqual(facts.enemies,['布隆']);
 assert.doesNotMatch(JSON.stringify(facts),/private-player/);
 assert.doesNotMatch(viewerReply('现在多少金币',{gold:null}),/0 金|金币 0/);
});
test('actual viewer log files populate active overlay once without entering personal memory',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'jinbao-viewer-routing-'));await mkdir(join(dir,'logs'));
 const now=Date.now();await writeFile(join(dir,'logs','lol-live.jsonl'),JSON.stringify({game:'lol',t:now,kind:'state',me:{champion:'安妮'},state:{time:300}})+'\n');
 const service=await createOverlayService({stateDir:dir,pollMs:20,search:()=>{throw Error('no network')},complete:()=>{throw Error('no model')}});t.after(service.close);
 const before=service.view(),common={game:before.game,match:before.match,viewerMessageId:'file-test',user:'观众测试'};
 await appendFile(join(dir,'logs','viewer.jsonl'),JSON.stringify({...common,t:now+1,kind:'viewer_message',text:'@金宝 弹幕链路验收'})+'\n');
 await appendFile(join(dir,'logs','coach_broadcasts.jsonl'),JSON.stringify({...common,t:now+2,kind:'viewer_reply',broadcast:'观众专属验收回答',noSpeech:true})+'\n');
 for(let i=0;i<100&&!service.view().chat.includes('观众专属验收回答');i++)await new Promise(resolve=>setTimeout(resolve,20));
 const view=service.view();assert.equal(view.match,before.match);assert.equal(view.gameTime,'05:00');
 assert.match(view.chat,/弹幕链路验收/);assert.match(view.chat,/观众专属验收回答/);
 assert.equal(view.playback.find(row=>row.text.includes('观众专属验收回答')).noSpeech,true);
 await service.close();
 const memoryDir=join(dir,'game-memory');
 for(const name of await readdir(memoryDir))if(name.endsWith('.json'))assert.doesNotMatch(await readFile(join(memoryDir,name),'utf8'),/弹幕链路验收|观众专属验收回答/);
});
