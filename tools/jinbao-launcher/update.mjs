import { createHash, randomUUID, verify } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, open, unlink, readdir, lstat, rm, link, copyFile, cp } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const UPDATE_FEED = 'https://api.jinbaoai.top/downloads/dsh/latest.json';
export const STANDALONE_FEED = 'https://api.jinbaoai.top/downloads/jinbao/latest.json';
const MAX_ARCHIVE = 160 * 1024 * 1024;
// 下载停流超过这个时间就当断线，重连续传（旧实现要等 15 分钟总超时才报错）。
const STALL_MS = 30000;
const MAX_EXPANDED = 300 * 1024 * 1024;
const exec = promisify(execFile);
const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function compareVersions(a, b) {
  const parts = value => {
    if (typeof value !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) throw Error('Invalid release version');
    return value.split('.').map(Number);
  };
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function verifyRelease(envelope, publicKey, channel='legacy') {
  if(!['legacy','standalone'].includes(channel))throw Error('Invalid update channel');
  if (!envelope || typeof envelope.payload !== 'string' || envelope.payload.length > 12000 || typeof envelope.signature !== 'string') throw Error('Invalid release envelope');
  const payload = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (payload.toString('base64') !== envelope.payload || signature.length !== 64 || !verify(null, payload, publicKey, signature)) throw Error('Invalid release signature');
  const release = JSON.parse(payload);
  compareVersions(release.version, release.version);
  const directory=channel==='standalone'?'jinbao':'dsh';
  if ((channel==='standalone'?release.runtime!=='standalone':release.runtime!==undefined&&release.runtime!=='legacy')||release.url !== `https://api.jinbaoai.top/downloads/${directory}/v${release.version}/jinbao-desktop-windows.zip` ||
      !Number.isSafeInteger(release.bytes) || release.bytes <= 0 || release.bytes > MAX_ARCHIVE ||
      !/^[a-f0-9]{64}$/.test(release.sha256) || !/^[a-f0-9]{64}$/.test(release.manifestSha256)) throw Error('Invalid release metadata');
  if(release.notes!==undefined&&(typeof release.notes!=='string'||release.notes.length>4000))throw Error('Invalid release notes');
  if(release.app!==undefined){
    // 应用层包：只含除运行时以外的文件，运行时从当前安装硬链接过去。
    // 包体 39MB 里有 32MB 是从不变化的 node.exe，每次更新都重下它纯属浪费（也更容易下到一半断掉）。
    const app=release.app,sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    if(!app||typeof app!=='object'||Array.isArray(app)||
       app.url!==`https://api.jinbaoai.top/downloads/${directory}/v${release.version}/jinbao-desktop-windows-app.zip`||
       !Number.isSafeInteger(app.bytes)||app.bytes<=0||app.bytes>MAX_ARCHIVE||!sha(app.sha256)) throw Error('Invalid release metadata');
    const base=app.base;
    if(!base||typeof base!=='object'||base.path!=='runtime/node.exe'||
       !Number.isSafeInteger(base.bytes)||base.bytes<=0||base.bytes>MAX_ARCHIVE||!sha(base.sha256)) throw Error('Invalid release metadata');
  }
  if(release.patch!==undefined){
  const patch=release.patch,sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||
  patch.url!==`https://api.jinbaoai.top/downloads/${directory}/v${release.version}/jinbao-desktop-windows-patch.zip`||
  !Number.isSafeInteger(patch.bytes)||patch.bytes<=0||patch.bytes>MAX_ARCHIVE||!sha(patch.sha256)||
  !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(patch.baseVersion)||!sha(patch.baseManifestSha256)) throw Error('Invalid release metadata');
  }
  return release;
}

function safeRelative(path) {
  return typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes(':') &&
    !path.includes('\0') && !path.startsWith('/') && !path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p));
}

export async function verifyPackage(root, release) {
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  if (manifestBytes.length > 2 * 1024 * 1024 || digest(manifestBytes) !== release.manifestSha256) throw Error('Package manifest mismatch');
  const manifest = JSON.parse(manifestBytes);
  if(release.runtime==='standalone'&&manifest.runtime!=='standalone')throw Error('Wrong package runtime');
  if (manifest.version !== release.version || !Array.isArray(manifest.files) || manifest.files.length > 5000) throw Error('Invalid package manifest');
  const expected = new Set(['manifest.json']); let total = 0;
  for (const item of manifest.files) {
    if (!safeRelative(item.path) || expected.has(item.path.toLowerCase()) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Unsafe package entry');
    expected.add(item.path.toLowerCase()); total += item.bytes;
    if (total > MAX_EXPANDED) throw Error('Expanded package too large');
  }
  const found = new Set();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error('Package contains a link');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const name = relative(root, path).replaceAll('\\', '/').toLowerCase();
        if (!expected.has(name) || found.has(name)) throw Error('Unexpected package file');
        found.add(name);
      } else throw Error('Unsupported package file');
    }
  }
  await walk(root);
  if (found.size !== expected.size) throw Error('Package files missing');
  for (const item of manifest.files) {
    const path = join(root, item.path);
    if ((await lstat(path)).size !== item.bytes || digest(await readFile(path)) !== item.sha256) throw Error('Package file mismatch');
  }
  const requiredFiles=release.runtime==='standalone'?['runtime/node.exe','start-preview.vbs','tools/cloud-desktop/entry.mjs','tools/cloud-desktop/main.mjs','tools/jinbao-launcher/update.mjs']:['runtime/node.exe','start-jinbao.vbs','tools/jinbao-launcher/start.ps1','tools/jinbao-launcher/main.mjs','tools/jinbao-launcher/update.mjs'];
  for (const required of requiredFiles) {
    if (!found.has(required.toLowerCase())) throw Error('Incomplete launcher package');
  }
  return manifest;
}

async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
async function boundedResponse(response, maximum) {
  if (!response.ok || !response.body) throw Error('Update service unavailable');
  let bytes = 0; const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length; if (bytes > maximum) throw Error('Update metadata too large'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function extractArchive(archive, destination) {
  const ps = join(process.env.SystemRoot ?? 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  await exec(ps, ['-NoProfile','-ExecutionPolicy','Bypass','-File',join(moduleDir,'extract-update.ps1'),'-Archive',archive,'-Destination',destination], { windowsHide: true, timeout: 120000, maxBuffer: 16384 });
}

// 分块算哈希：node.exe 有 90MB，读成一块会让内存和耗时都不好看。
async function hashFile(path) {
  const digestOf = createHash('sha256'), handle = await open(path,'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      digestOf.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
  } finally { await handle.close(); }
  return digestOf.digest('hex');
}

export function createUpdater({ root, stateDir, fetchImpl = fetch, publicKey, extract = extractArchive, now = Date.now, channel='legacy' }) {
  if(!['legacy','standalone'].includes(channel))throw Error('Invalid update channel');
  const updates = join(resolve(stateDir),'updates');
  let busy = false;
  async function key() { return publicKey ?? await readFile(join(moduleDir,'update-public.pem'),'utf8'); }
  async function status(value) {
    await mkdir(updates,{recursive:true});
    await atomicJson(join(updates,'status.json'),{...value,at:now()});
  }
  async function receipt(name) {
    const envelope = await readJson(join(updates,name+'.json'));
    if (!envelope) return null;
    const release = verifyRelease(envelope,await key(),channel);
    const directory = join(updates,'releases','v'+release.version);
    await verifyPackage(directory,release);
    return {root:directory,envelope,release};
  }
  // 本地运行时与这一版发布声明完全一致时只下载应用层；否则老实下全量包。
  async function patchPlanFor(release,current) {
  const patch=release.patch;
  if(!patch||typeof patch!=='object')return null;
  if(patch.baseVersion!==current.version)return null;
  try {
  const bytes=await readFile(join(resolve(root),'manifest.json'));
  return digest(bytes)===patch.baseManifestSha256?patch:null;
  } catch { return null; }
  }
  async function applyPatch(patchDirectory,staging) {
  const bytes=await readFile(join(patchDirectory,'patch-manifest.json'));
  if(bytes.length>2*1024*1024)throw Error('Invalid patch manifest');
  const patch=JSON.parse(bytes);
  if(typeof patch.baseVersion!=='string'||typeof patch.version!=='string')throw Error('Invalid patch manifest');
  const files=Array.isArray(patch.files)?patch.files:[],removed=Array.isArray(patch.removed)?patch.removed:[];
  if(files.length>5000||removed.length>5000)throw Error('Invalid patch manifest');
  await cp(resolve(root),staging,{recursive:true});
  for(const item of files){
  if(!safeRelative(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Unsafe patch entry');
  const source=join(patchDirectory,item.path),target=join(staging,item.path);
  if((await lstat(source)).size!==item.bytes||digest(await readFile(source))!==item.sha256)throw Error('Patch file mismatch');
  await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
  }
  for(const path of removed){
  if(!safeRelative(path))throw Error('Unsafe patch removal');
  await rm(join(staging,path),{force:true,recursive:true});
  }
  return patch;
  }
  async function appPlanFor(release) {
    const app=release.app;
    if(!app||typeof app!=='object')return null;
    try {
      const local=join(resolve(root),app.base.path),info=await lstat(local);
      if(!info.isFile()||info.size!==app.base.bytes)return null;
      if(await hashFile(local)!==app.base.sha256)return null;
      return app;
    } catch { return null; }
  }
  // 应用层包里没有 node.exe：用硬链接把当前安装里的那份挂过来（同卷不占额外空间），
  // 失败就退回复制。之后 verifyPackage 会按发布清单核对它的字节与哈希。
  async function provideBase(directory,base) {
    const source=join(resolve(root),base.path),target=join(directory,base.path);
    await mkdir(dirname(target),{recursive:true});
    try { await link(source,target); } catch { await copyFile(source,target); }
  }
  return {
    async check(signal, { force = false } = {}) {
      if (busy) return;
      busy = true; let archive, staging, patchDirectory,phase='checking',currentVersion,targetVersion;
      try {
        const current = JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
        currentVersion=current.version;
        await status({state:'checking',version:current.version,currentVersion,message:'正在检查更新…'});
        const response = await fetchImpl(channel==='standalone'?STANDALONE_FEED:UPDATE_FEED,{redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])});
        const envelope = JSON.parse(await boundedResponse(response,16384));
        const release = verifyRelease(envelope,await key(),channel);
        targetVersion=release.version;
        if (compareVersions(release.version,current.version) <= 0) {
          await status({state:'current',version:current.version,currentVersion,notes:release.notes,message:'已是最新版本 '+current.version}); return;
        }
      const rejected = await readJson(join(updates,'rejected.json'));
      if (rejected?.version === release.version) {
        if (!force) { await status({state:'failed',version:current.version,message:'上次更新未能启动，已保留原版本；点击「重试更新」可重新下载并安装。'}); return; }
        await unlink(join(updates,'rejected.json')).catch(()=>{});
      }
        const pending = await receipt('pending').catch(()=>null);
        if (pending && compareVersions(pending.release.version,release.version) >= 0) {
          await status({state:'ready',version:pending.release.version,currentVersion,notes:pending.release.notes,message:'新版 '+pending.release.version+' 已就绪，可在方便时安装'}); return;
        }
        const active = await receipt('active').catch(()=>null);
        if (active && compareVersions(active.release.version,release.version) >= 0) {
          await status({state:'ready',version:active.release.version,currentVersion,notes:active.release.notes,message:'新版 '+active.release.version+' 已就绪，可在方便时安装'}); return;
        }
        const patchPlan=await patchPlanFor(release,current);
        const appPlan=patchPlan?null:await appPlanFor(release);
        const target=patchPlan??appPlan??{url:release.url,bytes:release.bytes,sha256:release.sha256};
        await mkdir(join(updates,'releases'),{recursive:true});
        phase='downloading';
        await status({state:'downloading',version:release.version,currentVersion,downloadedBytes:0,totalBytes:target.bytes,percent:0,appOnly:appPlan!==null,patchOnly:patchPlan!==null,notes:release.notes,message:'正在后台下载新版 '+release.version});
        const downloadSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15*60*1000)]);
        archive=join(updates,'download-'+randomUUID()+'.zip');
        const started=now();let count=0,lastProgress=0;let hash=createHash('sha256');
        const file=await open(archive,'w');
        try {
          // 断点续传 + 停流重连：发布包 48MB、服务器对外约 420KB/s，纯等待就要两分钟；
          // 连接被掐断时旧实现会一直挂着直到 15 分钟总超时，用户看到的就是「卡在一半」。
          let attempt=0,lastError=null;
          while(count<target.bytes){
            attempt+=1;
            const controller=new AbortController();
            let stallTimer=null;
            const armStall=()=>{clearTimeout(stallTimer);stallTimer=setTimeout(()=>controller.abort(),STALL_MS);};
            try{
              armStall();
              const download=await fetchImpl(target.url,{redirect:'error',
                signal:AbortSignal.any([downloadSignal,controller.signal]),
                ...(count?{headers:{Range:'bytes='+count+'-'}}:{})});
              if(download.status===416)break;
              if(!download.ok||!download.body)throw Error('Update download failed');
              if(count>0&&download.status===200){await file.truncate(0);count=0;hash=createHash('sha256');}
              for await (const chunk of download.body){
                armStall();
                const at=count;
                count+=chunk.length;if(count>target.bytes)throw Error('Update size mismatch');
                hash.update(chunk);await file.write(chunk,0,chunk.length,at);
                if(now()-lastProgress>=500||count===target.bytes){
                  lastProgress=now();
                  const speed=Math.round(count/Math.max(.001,(now()-started)/1000));
                  await status({state:'downloading',version:release.version,currentVersion,notes:release.notes,
                    downloadedBytes:count,totalBytes:target.bytes,appOnly:appPlan!==null,
                    percent:Math.min(100,Math.floor(count/target.bytes*100)),
                    bytesPerSecond:speed,
                    etaMs:speed>0?Math.round((target.bytes-count)/speed*1000):null,
                    message:'正在后台下载新版 '+release.version+' · '+Math.floor(count/target.bytes*100)+'%'});
                }
              }
            }catch(error){lastError=error;}
            finally{clearTimeout(stallTimer);}
            if(count>=target.bytes)break;
            if(attempt>=3)throw lastError??Error('Update download interrupted');
            await new Promise(resolve=>setTimeout(resolve,1000));
          }
        } finally { await file.close(); }
        phase='verifying';
        await status({state:'verifying',version:release.version,currentVersion,notes:release.notes,message:'下载完成，正在验证更新完整性…'});
        if(count!==target.bytes||hash.digest('hex')!==target.sha256)throw Error('Update checksum mismatch');
        staging=join(updates,'staging-'+randomUUID());
        phase='extracting';
        await status({state:'extracting',version:release.version,currentVersion,notes:release.notes,message:'验证通过，正在准备安装文件…'});
        if(patchPlan){
        patchDirectory=join(updates,'patch-'+randomUUID());
        try{
        await extract(archive,patchDirectory);
        await applyPatch(patchDirectory,staging);
        }finally{
        await rm(patchDirectory,{recursive:true,force:true}).catch(()=>{});
        }
        }else{
        await extract(archive,staging);
        if(appPlan)await provideBase(staging,appPlan.base);
        }
        await verifyPackage(staging,release);
        const destination=join(updates,'releases','v'+release.version);
        try { await rename(staging,destination); }
        catch(error) { await verifyPackage(destination,release).catch(()=>{throw error;}); }
        await atomicJson(join(updates,'pending.json'),envelope);
        await atomicJson(join(updates,'ready-context.json'),{version:release.version,fromVersion:current.version,notes:release.notes});
        await status({state:'ready',version:release.version,currentVersion,notes:release.notes,message:'新版 '+release.version+' 已就绪，可在方便时安装'});
      } catch (error) {
        if(!signal?.aborted){
          const prepared=await receipt('pending').catch(()=>null);
          const usable=prepared&&currentVersion&&compareVersions(prepared.release.version,currentVersion)>0;
          await status(usable?{state:'ready',version:prepared.release.version,currentVersion,notes:prepared.release.notes,message:'本次检查未完成；已下载的新版仍可安装'}:{state:'failed',currentVersion,version:targetVersion,failedPhase:phase,retryable:true,message:{checking:'暂时无法检查更新，当前版本可继续使用。请检查网络后重试。',downloading:'下载未完成，当前版本可继续使用，点击重试重新下载。',verifying:'更新文件验证失败，已丢弃下载，当前版本未受影响。',extracting:'准备更新文件失败，请检查磁盘空间后重试。'}[phase]}).catch(()=>{});
        }
      } finally {
        if(archive)await unlink(archive).catch(()=>{});
        if(staging) {
          const child=relative(updates,resolve(staging));
          if(/^staging-[a-f0-9-]{36}$/.test(child))await rm(resolve(staging),{recursive:true,force:true}).catch(()=>{});
        }
        busy=false;
      }
    },
    async retry() {
    await unlink(join(updates,'rejected.json')).catch(()=>{});
    return this.check(undefined,{force:true});
  },
  async resolve() {
      const current=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
      for(const name of ['pending','active','previous']) {
        try {
          const candidate=await receipt(name);
          const rejected=await readJson(join(updates,'rejected.json'));
          if(candidate&&candidate.release.version!==rejected?.version&&compareVersions(candidate.release.version,current.version)>0)return candidate.root;
        } catch { /* A partial or damaged update never prevents portable startup. */ }
      }
      return root;
    },
    async prepared(){
      const current=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
      for(const name of ['pending','active']){
        const candidate=await receipt(name).catch(()=>null),rejected=await readJson(join(updates,'rejected.json'));
        if(candidate&&candidate.release.version!==rejected?.version&&compareVersions(candidate.release.version,current.version)>=0)return {root:candidate.root,release:candidate.release};
      }
      return null;
    },
    async healthy() {
      const pending=await receipt('pending').catch(()=>null);
      if(pending&&resolve(pending.root)===resolve(root)) {
        const active=await readJson(join(updates,'active.json'));
        if(active)await atomicJson(join(updates,'previous.json'),active);
        await atomicJson(join(updates,'active.json'),pending.envelope);
        await unlink(join(updates,'pending.json')).catch(()=>{});
        const context=await readJson(join(updates,'ready-context.json'));
        await atomicJson(join(updates,'result.json'),{id:randomUUID(),state:'success',version:pending.release.version,fromVersion:context?.version===pending.release.version?context.fromVersion:null,notes:pending.release.notes,message:'更新成功，已运行 '+pending.release.version,at:now()});
        await atomicJson(join(updates,'apply-status.json'),{state:'complete',version:pending.release.version,message:'更新成功，已运行 '+pending.release.version,at:now()});
        await status({state:'current',version:pending.release.version,notes:pending.release.notes,message:'已更新到 '+pending.release.version});
      }
    },
    async reject() {
      const current=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
      await mkdir(updates,{recursive:true});
      await atomicJson(join(updates,'rejected.json'),{version:current.version,at:now()});
      await status({state:'failed',message:'新版启动失败，已回退到原版本'});
      await atomicJson(join(updates,'result.json'),{id:randomUUID(),state:'rollback',version:current.version,message:'新版 '+current.version+' 启动失败，已自动回退，原有设置保留。',at:now()});
    },
  };
}

if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  if(!args.includes('--root')||!args.includes('--state')||!isAbsolute(value('--root'))||!isAbsolute(value('--state')))throw Error('Absolute update paths required');
  const updater=createUpdater({root:value('--root'),stateDir:value('--state')});
  if(args.includes('--resolve'))console.log(JSON.stringify({root:await updater.resolve()}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
  else if(args.includes('--reject'))await updater.reject();
}
