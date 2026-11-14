import test from 'node:test';
import assert from 'node:assert/strict';
import {activityLine} from '../activity-line.mjs';
import {initialOverlayState,applyOverlayEvent,withEventFallback} from '../overlay-state.mjs';
const base={enabled:true,revision:1,rows:[{id:'tool',label:'查询攻略',phase:'running'}]};
test('events get readable slots during tool execution, never repeat or leak across matches',()=>{
 const s={match:'m',events:[{key:'1',kind:'Ace',time:'05:00',text:'敌方团灭'},{key:'2',kind:'purchase',time:'05:01',text:'装备成型'}]};
 assert.equal(activityLine(base,s,100).rows[0].label,'敌方团灭');
 assert.equal(activityLine(base,s,3000).rows[0].label,'敌方团灭');
 assert.equal(activityLine(base,s,4100).rows[0].label,'装备成型');
 assert.equal(activityLine(base,s,8100).rows[0].id,'tool');
 assert.equal(activityLine(base,s,12100).rows[0].id,'tool');
 s.match='next';s.events=[];assert.equal(activityLine(base,s,13000).rows[0].id,'tool');
 assert.equal(activityLine({...base,enabled:false},s,14000).rows.length,0);
});
test('OCR kill and tower announcements are display-only and deduplicated',()=>{
 const s=initialOverlayState();applyOverlayEvent(s,{game:'lol',kind:'game_start',t:100,me:{champion:'安妮'}},'m');
 const e={game:'lol',kind:'chat_events',t:101,events:[{kind:'kill',time:'02:01',killer:'private-player'},{kind:'Ace',time:'02:02'}]};
 applyOverlayEvent(s,e,'m');applyOverlayEvent(s,e,'m');
 assert.equal(s.activityEvents.length,2);assert.equal(s.events.some(e=>e.kind==='kill'),false);
 const row=withEventFallback(base,s).rows;assert.equal(row.length,1);assert.doesNotMatch(JSON.stringify(row),/private-player/);
});
test('equipment, kills, ace, towers and augment announcements all reach the single slot',()=>{
 const kinds=['inventory','ChampionKill','Ace','TurretKilled','augment_picked','augment_offer'];
 const s={match:'all',events:kinds.map((kind,i)=>({kind,key:String(i),text:kind,time:'03:20'}))};
 for(let i=0;i<kinds.length;i++){
  const result=activityLine(base,s,100+i*4000);assert.equal(result.rows.length,1);assert.equal(result.rows[0].kind,kinds[i]);
 }
 assert.equal(activityLine(base,s,24100).rows[0].id,'tool');
});
