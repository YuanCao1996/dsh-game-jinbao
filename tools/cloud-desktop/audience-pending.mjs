import {mkdir,open,rename,readFile,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const valid=p=>p&&typeof p==='object'&&!Array.isArray(p)
  &&Object.keys(p).every(k=>['account','identityKind','roomId','requestId','taskId'].includes(k))
  &&(p.identityKind===undefined||p.identityKind==='account-v1')
  &&/^[a-f0-9]{64}$/.test(p.account??'')&&/^[1-9][0-9]{0,11}$/.test(p.roomId??'')
  &&/^[a-f0-9-]{36}$/.test(p.requestId??'')
  &&(p.taskId===null||/^[a-f0-9]{32}$/.test(p.taskId??''));

// Stores references only: no bearer token, question, game context or answer.
export function createAudiencePendingStore(stateDir) {
  const path=join(stateDir,'audience-pending.json');let queue=Promise.resolve();
  const load=async()=>{
    let stat;
    try {stat=await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw Error('audience_pending_unreadable');}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('audience_pending_invalid');
    let value;try{value=JSON.parse(await readFile(path,'utf8'));}catch{throw Error('audience_pending_invalid');}
    if(value?.version!==1||!Object.hasOwn(value,'pending')||(value.pending!==null&&!valid(value.pending)))
      throw Error('audience_pending_invalid');
    return value.pending;
  };
  const save=pending=>{
    if(pending!==null&&!valid(pending))return Promise.reject(Error('audience_pending_invalid'));
    const next=queue.then(async()=>{
      await mkdir(stateDir,{recursive:true});
      const tmp=path+'.'+randomUUID()+'.tmp';let file;
      try{
        file=await open(tmp,'wx',0o600);
        await file.writeFile(JSON.stringify({version:1,pending}));await file.sync();
        await file.close();file=null;await rename(tmp,path);
        if(process.platform!=='win32'){const parent=await open(stateDir,'r');try{await parent.sync();}finally{await parent.close();}}
      }finally{await file?.close();await unlink(tmp).catch(()=>{});}
    });
    queue=next.catch(()=>{});return next;
  };
  return {load:async()=>{await queue;return load();},save,clear:()=>save(null)};
}
