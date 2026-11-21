import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {homedir} from 'node:os';
import {createUpdater} from '../jinbao-launcher/update.mjs';
import {writeFile} from 'node:fs/promises';
export function startupFailure(stderr,exitCode){
 const code=String(stderr).match(/Error:\s+(E[A-Z0-9_]+):/)?.[1]??'STARTUP_FAILED';
 const path=String(stderr).match(/(?:open|rename|mkdir)\s+'([^'\r\n]+)'/)?.[1];
 return {code,file:path?.split(/[\\/]/).at(-1)??null,exitCode:Number.isInteger(exitCode)?exitCode:null};
}
export async function runEntry({root,stateDir,args=[],spawnImpl=spawn,updater=createUpdater({root,stateDir,channel:'standalone'}),startupTimeoutMs=30000}){
 let candidate=await updater.resolve(),fallback=false;
 while(true){
  let ready=false,restart=false,child,timer,stderr='';const current=createUpdater({root:candidate,stateDir,channel:'standalone'});
  const code=await new Promise((accept,reject)=>{
   child=spawnImpl(join(candidate,'runtime/node.exe'),[join(candidate,'tools/cloud-desktop/main.mjs'),'--state',stateDir,...args],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,JINBAO_LAUNCHER:join(root,'jinbao.exe')}});
   child.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-16384);});
   timer=setTimeout(()=>child.kill(),startupTimeoutMs);
   child.on('message',message=>{
    if(message?.action==='ready'){ready=true;clearTimeout(timer);void current.healthy().catch(()=>{});process.stdout.write(JSON.stringify({standalone:true,managedEntry:true})+'\n');}
    if(message?.action==='restart-update')restart=true;
   });child.once('error',reject);child.once('exit',accept);
  }).catch(()=>-1).finally(()=>clearTimeout(timer));
  if(!ready)await writeFile(join(root,'startup-failure.json'),JSON.stringify({...startupFailure(stderr,code),at:Date.now()}),{mode:0o600}).catch(()=>{});
  if(!ready&&candidate!==root&&!fallback){await current.reject();candidate=root;fallback=true;continue;}
  if(restart&&ready&&code===0){candidate=await updater.resolve();fallback=false;continue;}
  return ready?code??1:1;
 }
}
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2),index=args.indexOf('--state');
 const stateDir=resolve(index>=0?args.splice(index,2)[1]:join(homedir(),'.jinbao-cloud-preview'));
 process.exitCode=await runEntry({root,stateDir,args});
}
