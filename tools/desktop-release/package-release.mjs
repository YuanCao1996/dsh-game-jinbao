import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

// 独立桌面版的发布打包：一次产出全量包与「应用层」包，并把签名要用的字段算好。
// 应用层包只少了 runtime/node.exe —— 那是 90MB 且跨版本不变的运行时，
// 更新时由安装器从当前安装硬链接过去，用户就不必每次都重下它（39MB → 6MB）。
const BASE_PATH = 'runtime/node.exe';
const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const powershell = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

async function pack(source, archive, skip = []) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(moduleDir, 'pack-zip.ps1'), '-Source', source, '-Archive', archive];
  if (skip.length) args.push('-Skip', ...skip);
  await promisify(execFile)(powershell, args, { windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 65536 });
}

export async function packageRelease({ directory, out, basePath = BASE_PATH }) {
  const manifestBytes = await readFile(join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const base = manifest.files?.find(item => item.path?.toLowerCase() === basePath.toLowerCase());
  if (!base) throw Error('Package manifest has no ' + basePath);
  await mkdir(out, { recursive: true });
  const full = join(out, 'jinbao-desktop-windows.zip');
  const app = join(out, 'jinbao-desktop-windows-app.zip');
  await pack(directory, full);
  await pack(directory, app, [basePath]);
  const fullBytes = await readFile(full), appBytes = await readFile(app);
  return {
    version: manifest.version,
    bytes: fullBytes.length,
    sha256: digest(fullBytes),
    manifestSha256: digest(manifestBytes),
    app: { bytes: appBytes.length, sha256: digest(appBytes), base: { path: basePath, bytes: base.bytes, sha256: base.sha256 } },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, out] = process.argv.slice(2);
  if (!directory || !out) throw Error('Usage: package-release.mjs <built-directory> <output-directory>');
  if (process.platform !== 'win32') throw Error('Standalone packages are built on Windows');
  if (!(await stat(directory)).isDirectory()) throw Error('Not a directory: ' + directory);
  const feed = await packageRelease({ directory: resolve(directory), out: resolve(out) });
  await writeFile(join(resolve(out), 'feed-fields.json'), JSON.stringify(feed, null, 2));
  console.log(JSON.stringify(feed, null, 2));
}
