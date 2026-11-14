// Presentation queue only. Never requests a model, replays an event twice, or leaks raw OCR.
import {createHash} from 'node:crypto';
const queues=new WeakMap();
const kinds=new Set(['Ace','TurretKilled','InhibKilled','InhibRespawningSoon','InhibRespawned','DragonKill','BaronKill','HeraldKill','Multikill','Death','ChampionKill','kill','death','ace','tower','turret','augment_offer','augment_picked','augment_picked_chat','inventory','augment_mutate','purchase']);
export function activityLine(base,state,now=Date.now()){
 if(!base.enabled)return {...base,rows:[]};
 let q=queues.get(state);
 if(!q||q.match!==state.match){q={match:state.match,seen:new Set(),pending:[],current:null,until:0};queues.set(state,q);}
 const events=[...(state.events??[]),...(state.activityEvents??[])];
 for(const e of events){
  if(!kinds.has(e.kind)||!e.text)continue;
  if(e.kind==='augment_mutate'&&/归属未确认|归属不明/.test(e.text))continue;
  const key=e.key??JSON.stringify([e.kind,e.time,e.text]);
  if(q.seen.has(key))continue;q.seen.add(key);
  q.pending.push({id:'event-'+createHash('sha256').update(String(key)).digest('hex').slice(0,20),task:'events',topic:'本局事件',kind:e.kind,clock:e.time??'',label:String(e.text).replace(/\s+/g,' ').slice(0,180),phase:'done',expires:now+24000});
 }
 // Bound bursts: newest six announcements, one readable slot per four seconds.
 q.pending=q.pending.filter(e=>e.expires>now).slice(-6);
 if(q.seen.size>1000)q.seen=new Set([...q.seen].slice(-600));
 if(!q.current||now>=q.until){q.current=q.pending.shift()??null;q.until=now+4000;}
 const steps=base.rows??[];
 const learn=steps.find(e=>e.topic==='经验学习'&&Number.isFinite(e.at)&&now-e.at>=0&&now-e.at<5000);
 const step=steps.find(e=>['running','queued'].includes(e.phase))??steps[0];
 const row=q.current??learn??step;
 return {...base,revision:JSON.stringify([base.revision,row?.id,row?.label,row?.phase,row?.elapsedMs]),rows:row?[row]:[]};
}
