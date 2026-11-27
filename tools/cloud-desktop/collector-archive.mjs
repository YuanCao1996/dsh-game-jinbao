import {open,lstat,realpath,readFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {sha,rejected,normalizeCollectorRows} from './collector-codec.mjs';
const MAX=8*1024*1024;
const empty=sha('');
export async function readCollectorArchive({stateDir,key,account,game,match}){
 if(!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9]{64}$/.test(account))throw rejected();
 const approvedState=await realpath(stateDir),root=resolve(approvedState,'game-memory'),file=join(root,key+'.jsonl'),cursorFile=join(approvedState,'node-collector','cursors',account+'-'+key+'.json');
 let cursor;
 try{const info=await lstat(cursorFile);if(info.isSymbolicLink()||info.size>2048)throw rejected();cursor=JSON.parse(await readFile(cursorFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw rejected();}
 const read=async()=>{
  if(await realpath(root)!==root)throw rejected();
  const before=await lstat(file,{bigint:true});if(before.isSymbolicLink()||!before.isFile()||before.size>BigInt(MAX))throw rejected();
  const handle=await open(file,'r');
  try{
   const info=await handle.stat({bigint:true});if(info.dev!==before.dev||info.ino!==before.ino||info.size>BigInt(MAX))throw rejected();
   const bytes=Buffer.alloc(Number(info.size));let used=0;
   while(used<bytes.length){const part=await handle.read(bytes,used,bytes.length-used,used);if(!part.bytesRead)throw rejected();used+=part.bytesRead;}
   const after=await lstat(file,{bigint:true});if(after.isSymbolicLink()||after.dev!==info.dev||after.ino!==info.ino)throw rejected();
   return {bytes,dev:String(info.dev),ino:String(info.ino)};
  }finally{await handle.close();}
 };
 let source;try{source=await read();}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const {bytes,dev,ino}=source,offset=cursor?.offset??0;
 if(!Number.isSafeInteger(offset)||offset<0||offset>bytes.length||cursor&&(cursor.dev!==dev||cursor.ino!==ino||cursor.digest!==sha(bytes.subarray(0,offset))))throw rejected();
 let end=offset,count=0,issues=0;const rows=[];
 // Scan past frequent state snapshots locally, but bound uploaded critical
 // records separately so noisy captures do not cause a growing event delay.
 while(end<bytes.length&&count<100){
  const newline=bytes.indexOf(10,end);if(newline<0){if(bytes.length-end>240000)throw rejected();break;}
  if(newline+1-offset>256000&&count)break;
  const start=end;end=newline+1;count++;
  if(end-start>240000)throw rejected();if(end-start>60000){issues++;continue;}
  let row;try{row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,newline)));}catch{issues++;continue;}
  // Only the host's per-match archive, never a mixed raw source or query page.
  if(row?.game!==game||row?.match!==match)throw rejected();
  const converted=normalizeCollectorRows([{row,offset:start}],key);
  if(!converted.events.length){issues+=converted.issues;continue;}
  if(rows.length>=4){end=start;break;}
  rows.push({row,offset:start});
 }
 const checkpoint={dev,ino,offset:end,digest:sha(bytes.subarray(0,end))},base=cursor??{dev,ino,offset:0,digest:empty};
 return {rows,issues,advancedBytes:end-offset,commit:async()=>{
  const current=await read();if(current.dev!==dev||current.ino!==ino||sha(current.bytes.subarray(0,end))!==checkpoint.digest)throw rejected();
  let prior;try{prior=JSON.parse(await readFile(cursorFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw rejected();}
  if(prior&&JSON.stringify(prior)===JSON.stringify(checkpoint))return;
  if(prior?JSON.stringify(prior)!==JSON.stringify(base):offset!==0)throw rejected();
  const directory=join(approvedState,'node-collector','cursors');await mkdir(directory,{recursive:true});
  // This is a host-single-instance cursor, not a cross-process lock.
  const handle=await open(cursorFile+'.tmp','w',0o600);try{await handle.writeFile(JSON.stringify(checkpoint));await handle.sync();}finally{await handle.close();}
  await rename(cursorFile+'.tmp',cursorFile);
 }};
}
