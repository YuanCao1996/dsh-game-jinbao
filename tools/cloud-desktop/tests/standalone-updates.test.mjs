import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash}from'node:crypto';import {mkdtemp,mkdir,writeFile,readFile,cp,rm,stat}from'node:fs/promises';import{join,dirname}from'node:path';import{tmpdir}from'node:os';
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

// 应用层更新：包体里 90MB 是从不变化的 node.exe，每次更新重下它既慢又容易断。
// 本地那份与发布声明一致时只下应用层包，运行时用硬链接挂过来（同卷不占额外空间）。
async function appFixture({ localRuntime = Buffer.from('MZ fixture runtime binary') } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-app-update-'));
  const root = join(dir, 'old'), payloadDir = join(dir, 'app'), stateDir = join(dir, 'state');
  await mkdir(stateDir); await mkdir(join(root, 'runtime'), { recursive: true });
  const runtime = Buffer.from('MZ fixture runtime binary');
  await writeFile(join(root, 'runtime/node.exe'), localRuntime);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: '0.2.0', runtime: 'standalone', files: [] }));
  const files = [];
  for (const [path, text] of Object.entries({
    'start-preview.vbs': 'Rem', 'tools/cloud-desktop/entry.mjs': 'export {}',
    'tools/cloud-desktop/main.mjs': 'export {}', 'tools/jinbao-launcher/update.mjs': 'export {}',
  })) {
    const bytes = Buffer.from(text);
    await mkdir(dirname(join(payloadDir, path)), { recursive: true });
    await writeFile(join(payloadDir, path), bytes);
    files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  files.push({ path: 'runtime/node.exe', bytes: runtime.length, sha256: digest(runtime) });
  const manifest = Buffer.from(JSON.stringify({ version: '0.2.1', runtime: 'standalone', files }));
  await writeFile(join(payloadDir, 'manifest.json'), manifest);
  const appArchive = Buffer.from('app only archive bytes'), fullArchive = Buffer.from('full archive bytes');
  const base = 'https://api.jinbaoai.top/downloads/jinbao/v0.2.1/';
  const release = {
    runtime: 'standalone', version: '0.2.1', manifestSha256: digest(manifest),
    url: base + 'jinbao-desktop-windows.zip', bytes: fullArchive.length, sha256: digest(fullArchive),
    app: { url: base + 'jinbao-desktop-windows-app.zip', bytes: appArchive.length, sha256: digest(appArchive),
      base: { path: 'runtime/node.exe', bytes: runtime.length, sha256: digest(runtime) } },
  };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from(JSON.stringify(release));
  const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
  return { dir, root, payloadDir, stateDir, runtime, release, envelope, appArchive, fullArchive, publicKey, privateKey };
}

test('应用层更新只下载应用包，运行时从本机复用（硬链接，不额外占空间）', async () => {
  const f = await appFixture();
  try {
    const urls = [], says = [];
    const updater = createUpdater({ root: f.root, stateDir: f.stateDir, channel: 'standalone', publicKey: f.publicKey,
      extract: (_archive, destination) => cp(f.payloadDir, destination, { recursive: true }),
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith('latest.json')) return Response.json(f.envelope);
        says.push(JSON.parse(await readFile(join(f.stateDir, 'updates/status.json'), 'utf8')));
        return new Response(String(url).endsWith('-app.zip') ? f.appArchive : f.fullArchive);
      } });
    await updater.check();
    assert.ok(urls.some(u => u.endsWith('-app.zip')), '应当下载应用层包');
    assert.ok(!urls.some(u => u.endsWith('jinbao-desktop-windows.zip')), '不该再下全量包');
    assert.equal(says[0].appOnly, true);
    assert.equal(says[0].totalBytes, f.appArchive.length, '进度要按应用层包的体积算');
    const prepared = await updater.prepared();
    assert.equal(prepared.release.version, '0.2.1');
    const copied = join(prepared.root, 'runtime/node.exe');
    assert.deepEqual(await readFile(copied), f.runtime, '运行时内容要与本机那份一致');
    if (process.platform === 'win32') {
      assert.equal((await stat(copied)).ino, (await stat(join(f.root, 'runtime/node.exe'))).ino, '应当是硬链接而不是复制');
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('本机运行时对不上发布声明时退回全量包，绝不拿错版本的运行时凑数', async () => {
  const f = await appFixture({ localRuntime: Buffer.from('MZ something else entirely') });
  try {
    const urls = [], says = [];
    const updater = createUpdater({ root: f.root, stateDir: f.stateDir, channel: 'standalone', publicKey: f.publicKey,
      extract: async (_archive, destination) => {
        await cp(f.payloadDir, destination, { recursive: true });
        await mkdir(join(destination, 'runtime'), { recursive: true });
        await writeFile(join(destination, 'runtime/node.exe'), f.runtime);
      },
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (String(url).endsWith('latest.json')) return Response.json(f.envelope);
        says.push(JSON.parse(await readFile(join(f.stateDir, 'updates/status.json'), 'utf8')));
        return new Response(String(url).endsWith('-app.zip') ? f.appArchive : f.fullArchive);
      } });
    await updater.check();
    assert.ok(!urls.some(u => u.endsWith('-app.zip')), '运行时不一致时不能走应用层');
    assert.ok(urls.some(u => u.endsWith('jinbao-desktop-windows.zip')), '应当下载全量包');
    assert.equal(says[0].appOnly, false);
    assert.equal(says[0].totalBytes, f.fullArchive.length);
    assert.equal((await updater.prepared()).release.version, '0.2.1');
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('应用层包被篡改或签名里的应用层信息不合规时都不换版本', async () => {
  const f = await appFixture();
  try {
    const bare = createUpdater({ root: f.root, stateDir: f.stateDir, channel: 'standalone', publicKey: f.publicKey,
      extract: (_archive, destination) => cp(f.payloadDir, destination, { recursive: true }),
      fetchImpl: async (url) => String(url).endsWith('latest.json') ? Response.json(f.envelope) : new Response(Buffer.alloc(f.appArchive.length)) });
    await bare.check();
    assert.equal(await bare.resolve(), f.root, '校验不过的包不能上屏');
    assert.equal(JSON.parse(await readFile(join(f.stateDir, 'updates/status.json'), 'utf8')).state, 'failed');

    const signedAs = release => {
      const payload = Buffer.from(JSON.stringify(release));
      return { payload: payload.toString('base64'), signature: sign(null, payload, f.privateKey).toString('base64') };
    };
    assert.throws(() => verifyRelease(signedAs({ ...f.release, app: { ...f.release.app, url: 'https://evil.example/app.zip' } }), f.publicKey, 'standalone'), /Invalid release metadata/);
    assert.throws(() => verifyRelease(signedAs({ ...f.release, app: { ...f.release.app, base: { ...f.release.app.base, sha256: 'nope' } } }), f.publicKey, 'standalone'), /Invalid release metadata/);
    assert.throws(() => verifyRelease(signedAs({ ...f.release, app: { ...f.release.app, base: { ...f.release.app.base, path: 'runtime/other.exe' } } }), f.publicKey, 'standalone'), /Invalid release metadata/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});