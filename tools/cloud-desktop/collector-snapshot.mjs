import {open,lstat,realpath} from 'node:fs/promises';import {join} from 'node:path';
import {canonical,sha,rejected} from './collector-codec.mjs';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&[...value].length<=80?value:undefined;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const name=value=>{if(object(value))value=value.name??value.id;if(typeof value==='string'&&value&&[...value].length<=80)return value;if(Number.isSafeInteger(value))return value;return undefined;};
const names=(values,max)=>Array.isArray(values)?values.slice(0,max).map(name).filter(v=>v!==undefined):undefined;
function augments(values){
 if(!Array.isArray(values))return {owned:[],assumed:[]};
 const owned=[],assumed=[];
 for(const value of values.slice(0,16)){
  const label=name(value);if(label===undefined)continue;
  if(object(value)&&(value.confidence==='low'||value.source==='ocr-inferred'||value.source==='countdown-default-confirmed'||value.assumed===true||value.confirmed===false||value.selection_status!=null&&!['observed','user_confirmed'].includes(value.selection_status)))assumed.push(label);else owned.push(label);
 }
 return {owned,assumed};
}
function player(value){
 if(!object(value))return undefined;const result={};
 for(const key of ['champion','champion_id']){const label=name(value[key]);if(label!==undefined)result[key]=label;}
 for(const key of ['level','gold','health','mana']){const v=number(value[key]);if(v!==undefined)result[key]=v;}
 for(const [source,target] of [['hpPct','health_pct'],['respawn','respawn'],['k','kills'],['d','deaths'],['a','assists']]){const v=number(value[source]);if(v!==undefined)result[target]=v;}
 for(const [source,target] of [['dead','dead'],['canShop','can_shop']])if(typeof value[source]==='boolean')result[target]=value[source];
 const items=names(value.items,16);if(items)result.items=items;
 const known=augments(value.augments);if(known.owned.length)result.augments=known.owned;
 if(Array.isArray(value.spells))result.spells=value.spells.slice(0,4).flatMap(spell=>{
  if(!object(spell)){const label=name(spell);return label===undefined?[]:[label];}
  const compact={};for(const key of ['name','id']){const label=name(spell[key]);if(label!==undefined)compact[key]=label;}
  if(typeof spell.ready==='boolean')compact.ready=spell.ready;if(number(spell.cooldown)!==undefined&&spell.cooldown>=0)compact.cooldown=spell.cooldown;
  return Object.keys(compact).length?[compact]:[];
 });
 if(Buffer.byteLength(canonical(result))>2048)throw rejected();return result;
}
export function projectCollectorSnapshot(value,{game,match,now}){
 if(!object(value)||value.game!==game||value.match!==match)throw rejected();
 // Match the existing coach's observation clock: chat/broadcast writes must
 // never make old game telemetry appear fresh.
 const at=value.gameplayAt??value.at;if(!Number.isSafeInteger(at)||at<0||now-at>120000||at>now+5000)return null;
 const state={game_id:game,status:value.ended===true?'ended':'observed',revision:at,captured_at_ms:at};
 for(const key of ['mode','phase']){const v=text(value[key]);if(v!==undefined)state[key]=v;}
 if(number(value.gameSeconds)!==undefined&&value.gameSeconds>=0&&value.gameSeconds<=86400)state.game_time_seconds=value.gameSeconds;
 const me=player(value.me);if(me)state.me=me;
 for(const team of ['allies','enemies','bench'])if(Array.isArray(value[team]))state[team]=value[team].slice(0,team==='bench'?20:5).map(player).filter(Boolean);
 const selected=augments(value.ownedAugments);state.owned_augments=selected.owned;state.assumed_augments=selected.assumed;
 const offers=names(value.offers,6);if(offers)state.offers=offers;
 const ally=value.me?.teamKills,enemy=value.me?.enemyKills;if(Number.isSafeInteger(ally)&&ally>=0&&ally<=1000&&Number.isSafeInteger(enemy)&&enemy>=0&&enemy<=1000)state.team_score={ally,enemy};
 // These are structured observations. No chat, broadcasts, names, OCR, model
 // prompts, images, private memory or credentials enter the packet.
 const packet=JSON.parse(JSON.stringify({current_match_state:state,client_context:{game_id:game}}));
 if(Buffer.byteLength(canonical(state))>12000)throw rejected();
 return {packet,digest:sha(canonical({packet}))};
}
export async function readCollectorSnapshot({stateDir,key,game,match,now}){
 if(!/^[a-f0-9]{64}$/.test(key)||key!==sha(game+':'+match))throw rejected();
 const root=join(await realpath(stateDir),'game-memory'),file=join(root,key+'.json');
 try{
  if(await realpath(root)!==root)throw rejected();const before=await lstat(file,{bigint:true});if(before.isSymbolicLink()||!before.isFile()||before.size>BigInt(512*1024))throw rejected();
  const handle=await open(file,'r');try{
   const info=await handle.stat({bigint:true});if(info.dev!==before.dev||info.ino!==before.ino||info.size>BigInt(512*1024))throw rejected();
   const bytes=Buffer.alloc(Number(info.size));let used=0;while(used<bytes.length){const part=await handle.read(bytes,used,bytes.length-used,used);if(!part.bytesRead)throw rejected();used+=part.bytesRead;}
   const after=await lstat(file,{bigint:true});if(after.isSymbolicLink())throw rejected();if(after.ino!==info.ino||after.dev!==info.dev)return null; // atomic publication raced; poll again
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return projectCollectorSnapshot(value,{game,match,now});
  }finally{await handle.close();}
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
