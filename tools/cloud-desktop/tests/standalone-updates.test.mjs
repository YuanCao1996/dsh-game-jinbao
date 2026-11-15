import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash}from'node:crypto';import {mkdtemp,mkdir,writeFile,readFile,cp,rm}from'node:fs/promises';import{join,dirname}from'node:path';import{tmpdir}from'node:os';
import{createUpdater,verifyRelease}from'../../jinbao-launcher/update.mjs';import{createStandaloneUpdates}from'../updates.mjs';
import{runEntry}from'../entry.mjs';import{EventEmitter}from'node:events';
const digest=b=>createHash('sha256').update(b).digest('hex');
test('standalone signed channel rejects legacy packages, stages the right runtime and retains settings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jinbao-independent-update-'));const{privateKey,publicKey}=generateKeyPairSync('ed25519');
 try{
  const root=join(dir,'old'),next=join(dir,'new'),stateDir=join(dir,'state');await mkdir(root);await mkdir(next);await mkdir(stateDir);
  await writeFile(join(root,'manifest.json'),JSON.stringify({version:'0.2.0',runtime:'standalone',files:[]}));await writeFile(join(stateDir,'settings.json'),'{"mode":"byok"}');
  const files=[];for(const path of ['runtime/node.exe','start-preview.vbs','tools/cloud-desktop/entry.mjs','tools/cloud-desktop/main.mjs','tools/jinbao-launcher/update.mjs']){const bytes=Buffer.from('fixture '+path);await mkdir(join(next,path,'..'),{recursive:true});await writeFile(join(next,path),bytes);files.push({path,bytes:bytes.length,sha256:digest(bytes)});}
  const manifest=Buffer.from(JSON.stringify({version:'0.2.1',runtime:'standalone',files}));await writeFile(join(next,'manifest.json'),manifest);const archive=Buffer.from('signed fixture');
  const release={runtime:'standalone',version:'0.2.1',url:'https://api.jinbaoai.top/downloads/jinbao/v0.2.1/jinbao-desktop-windows.zip',bytes:archive.length,sha256:digest(archive),manifestSha256:digest(manifest),notes:'独立版更新'};
  const payload=Buffer.from(JSON.stringify(release)),envelope={payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};assert.throws(()=>verifyRelease(envelope,publicKey));assert.equal(verifyRelease(envelope,publicKey,'standalone').runtime,'standalone');
  const urls=[];const updater=createUpdater({root,stateDir,channel:'standalone',publicKey,extract:(_archive,destination)=>cp(next,destination,{recursive:true}),fetchImpl:async url=>{urls.push(String(url));return String(url).endsWith('latest.json')?Response.json(envelope):new Response(archive);}});
  await updater.check();assert.match(urls[0],/downloads\/jinbao\//);const prepared=await updater.prepared();assert.equal(prepared.release.version,'0.2.1');assert.equal(await updater.resolve(),prepared.root);assert.equal(JSON.parse(await readFile(join(stateDir,'settings.json'),'utf8')).mode,'byok');
  const controller=createStandaloneUpdates({root,stateDir,updater,restart:async()=>{urls.push('restarted');},now:()=>1000});await assert.rejects(controller.apply({match:'one',ended:false,gameTime:'01:00',updatedAt:1000}),e=>e.status===409);assert.ok(!urls.includes('restarted'));await controller.apply({ended:true});assert.ok(urls.includes('restarted'));await controller.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('update refusals carry a reason so the settings page never blames the model config',async()=>{
 // Nothing downloaded yet.
 const none=createStandaloneUpdates({root:'/x',stateDir:'/y',updater:{prepared:async()=>null},restart:async()=>{},now:()=>1});
 await assert.rejects(none.apply({ended:true}),e=>e.status===409&&e.code==='update_missing');
 await none.close();
 // Downloaded, but this launch mode has no supervisor channel to relaunch through.
 const prepared={root:'/z',release:{version:'0.2.6'}};
 const orphan=createStandaloneUpdates({root:'/x',stateDir:'/y',updater:{prepared:async()=>prepared},restart:null,now:()=>1});
 await assert.rejects(orphan.apply({ended:true}),e=>e.status===409&&e.code==='update_restart_unavailable');
 await orphan.close();
 // A live match is refused before the download is even considered.
 const busy=createStandaloneUpdates({root:'/x',stateDir:'/y',updater:{prepared:async()=>prepared},restart:async()=>{},now:()=>1000});
 await assert.rejects(busy.apply({match:'m',ended:false,gameTime:'01:00',updatedAt:1000}),e=>e.status===409&&e.code==='update_game_active');
 await busy.close();
});

test('standalone entry falls back after an executable startup error before ready',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jinbao-entry-fallback-')),root=join(dir,'old'),candidate=join(dir,'new'),stateDir=join(dir,'state'),starts=[];
 try{await mkdir(root);await mkdir(candidate);await mkdir(stateDir);await writeFile(join(candidate,'manifest.json'),JSON.stringify({version:'0.2.1'}));
 const code=await runEntry({root,stateDir,updater:{resolve:async()=>candidate},startupTimeoutMs:1000,spawnImpl:executable=>{const child=new EventEmitter();child.kill=()=>{};starts.push(executable);setImmediate(()=>{if(starts.length===1)child.emit('error',Error('fixture executable unavailable'));else{child.emit('message',{action:'ready'});child.emit('exit',0);}});return child;}});assert.equal(code,0);assert.equal(starts.length,2);assert.ok(starts[1].startsWith(root));assert.equal(JSON.parse(await readFile(join(stateDir,'updates/result.json'))).state,'rollback');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('下载中断后按 Range 续传，不会卡到 15 分钟超时', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-resume-'));
  try {
    const root = join(dir, 'old'), stateDir = join(dir, 'state'), next = join(dir, 'new');
    await mkdir(root); await mkdir(stateDir); await mkdir(next);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: '0.2.0', runtime: 'standalone', files: [] }));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const archive = Buffer.from('1234567890abcdef'.repeat(4));
    const contents = [
      ['runtime/node.exe', 'MZ'],
      ['start-preview.vbs', 'Rem'],
      ['tools/cloud-desktop/entry.mjs', 'export {}'],
      ['tools/cloud-desktop/main.mjs', 'export {}'],
      ['tools/jinbao-launcher/update.mjs', 'export {}'],
    ];
    const files = [];
    for (const [path, text] of contents) {
      const bytes = Buffer.from(text);
      await mkdir(dirname(join(next, path)), { recursive: true });
      await writeFile(join(next, path), bytes);
      files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
    const manifest = Buffer.from(JSON.stringify({ version: '0.2.1', runtime: 'standalone', files }));
    await writeFile(join(next, 'manifest.json'), manifest);
    const release = { runtime: 'standalone', version: '0.2.1',
      url: 'https://api.jinbaoai.top/downloads/jinbao/v0.2.1/jinbao-desktop-windows.zip',
      bytes: archive.length, sha256: digest(archive), manifestSha256: digest(manifest) };
    const payload = Buffer.from(JSON.stringify(release));
    const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
    let zipCalls = 0; const ranges = [];
    const fetchImpl = async (url, options = {}) => {
      if (String(url).includes('latest.json')) return Response.json(envelope);
      zipCalls += 1;
      ranges.push(options.headers?.Range ?? null);
      const from = options.headers?.Range ? Number(/bytes=(\d+)-/.exec(options.headers.Range)[1]) : 0;
      if (zipCalls === 1) {
        const half = archive.subarray(0, 32);
        return new Response(new ReadableStream({ start(c) { c.enqueue(half); setTimeout(() => c.error(Error('network stalled')), 10); } }), { status: 200 });
      }
      return new Response(archive.subarray(from), { status: from ? 206 : 200 });
    };
    const updater = createUpdater({ root, stateDir, channel: 'standalone', publicKey,
      extract: (_archive, destination) => cp(next, destination, { recursive: true }), fetchImpl });
    await updater.check();
    assert.equal(zipCalls, 2, '断流后应重连一次，而不是挂到超时');
    assert.equal(ranges[1], 'bytes=32-', '重连必须带 Range 续传');
    const prepared = await updater.prepared();
    assert.equal(prepared.release.version, '0.2.1');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
