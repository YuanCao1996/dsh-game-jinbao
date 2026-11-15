// 临时脚本：用真实安装目录跑一次「应用层更新」，验证下载、解压、硬链接、校验全流程。
import { readFile, mkdtemp, rm, stat, readdir } from 'node:fs/promises';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdater, verifyPackage, verifyRelease } from './tools/jinbao-launcher/update.mjs';

const deliver = process.argv[2], install = process.argv[3];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = JSON.parse(await readFile(join(deliver, 'feed-fields.json'), 'utf8'));
const base = `https://api.jinbaoai.top/downloads/jinbao/v${fields.version}/`;
const release = {
  runtime: 'standalone', version: fields.version,
  url: base + 'jinbao-desktop-windows.zip', bytes: fields.bytes, sha256: fields.sha256,
  manifestSha256: fields.manifestSha256, notes: '独立桌面版 0.2.35 预览：应用层更新验证',
  app: { url: base + 'jinbao-desktop-windows-app.zip', bytes: fields.app.bytes, sha256: fields.app.sha256, base: fields.app.base },
};
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const payload = Buffer.from(JSON.stringify(release));
const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
verifyRelease(envelope, publicKey, 'standalone');
console.log('签名校验通过', release.version);

const files = { '/latest.json': 'feed', '/jinbao-desktop-windows.zip': join(deliver, 'jinbao-desktop-windows.zip'), '/jinbao-desktop-windows-app.zip': join(deliver, 'jinbao-desktop-windows-app.zip') };
const served = [];
const server = createServer(async (req, res) => {
  served.push(req.url);
  if (req.url === '/latest.json') {
    const body = Buffer.from(JSON.stringify(envelope));
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
    return res.end(body);
  }
  const file = files[req.url];
  if (!file) { res.writeHead(404); return res.end(); }
  const size = (await stat(file)).size;
  res.writeHead(200, { 'content-length': size });
  createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const stateDir = await mkdtemp(join(tmpdir(), 'jinbao-e2e-'));
const local = url => `http://127.0.0.1:${port}${url.endsWith('.json') ? '/latest.json' : url.endsWith('-app.zip') ? '/jinbao-desktop-windows-app.zip' : '/jinbao-desktop-windows.zip'}`;
const history = [];
let downloadingStart = 0;
const updater = createUpdater({
  root: install, stateDir, channel: 'standalone', publicKey,
  fetchImpl: async (url, options) => {
    if (String(url).endsWith('latest.json')) return fetch(local(url), options);
    downloadingStart = Date.now();
    return fetch(local(url), options);
  },
});
try {
  const started = Date.now();
  await updater.check();
  const elapsed = (Date.now() - started) / 1000;
  history.push(JSON.parse(await readFile(join(stateDir, 'updates/status.json'), 'utf8')));
  const prepared = await updater.prepared();
  if (!prepared) throw Error('没有生成可安装的版本');
  const dir = prepared.root;
  const copied = join(dir, 'runtime/node.exe');
  const [a, b] = [await stat(copied), await stat(join(install, 'runtime/node.exe'))];
  let count = 0;
  async function walk(p) { for (const e of await readdir(p, { withFileTypes: true })) { e.isDirectory() ? await walk(join(p, e.name)) : count++; } }
  await walk(dir);
  const manifest = await verifyPackage(dir, release);
  console.log(JSON.stringify({
    served, elapsedSeconds: elapsed, downloadSeconds: (Date.now() - downloadingStart) / 1000,
    status: history[0].state, preparedVersion: prepared.release.version,
    fileCount: count, manifestFiles: manifest.files.length,
    runtimeBytes: b.size, hardLinked: a.ino === b.ino, ino: a.ino,
  }, null, 2));
  console.log('状态：' + history[0].state + ' / ' + history[0].message);
  if (a.ino !== b.ino) console.log('注意：不是硬链接（已退回复制）');
} finally {
  await updater.close?.();
  server.close();
  await rm(stateDir, { recursive: true, force: true });
}
