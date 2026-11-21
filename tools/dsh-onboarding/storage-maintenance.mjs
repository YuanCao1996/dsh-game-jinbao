// 状态目录的磁盘维护：高光/日志/对局记忆/旧版本都有上限，避免无限增长。
// 只删本模块能确定是“可再生”或“过期”的文件，不动当前对局正在写的文件。
import { readdir, stat, lstat, rm, readFile, statfs, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { resolve, parse, sep, join, dirname } from 'node:path';

export const MIGRATION_SCRIPT = "# \u628a\u72b6\u6001\u76ee\u5f55\u8fc1\u79fb\u5230\u5176\u4ed6\u76d8\uff1a\u9000\u51fa\u91d1\u5b9d\u540e\u590d\u5236\u3001\u6539\u540d\u3001\u5efa junction\uff0c\u518d\u91cd\u65b0\u542f\u52a8\u3002\n# \u7531\u8bbe\u7f6e\u9875 POST /api/storage/migrate \u89e6\u53d1\uff0c\u7236\u8fdb\u7a0b\u9000\u51fa\u540e\u7531\u672c\u811a\u672c\u63a5\u7ba1\u3002\nparam(\n  [Parameter(Mandatory = $true)][string]$From,\n  [Parameter(Mandatory = $true)][string]$To,\n  [int]$WaitPid = 0,\n  [string]$Launcher = ''\n)\n$ErrorActionPreference = 'Stop'\n$log = Join-Path $env:TEMP 'jinbao-storage-migrate.log'\nfunction Write-Log([string]$text) {\n  try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $text) -Encoding UTF8 } catch {}\n}\nfunction Stop-JinbaoChildren {\n  param([string]$StateDir)\n  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {\n    $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*-STA*' -and $_.CommandLine -like '*strategy-overlay.ps1*'\n  } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }\n  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {\n    $_.Name -eq 'node.exe' -and $_.CommandLine -like '*collector.mjs*' -and $_.CommandLine -like ('*' + $StateDir + '*')\n  } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }\n}\nfunction Fail([string]$message) {\n  Write-Log ('FAIL ' + $message)\n  throw $message\n}\n\ntry {\n  Write-Log \"start from=$From to=$To pid=$WaitPid\"\n  if ($WaitPid -gt 0) {\n    for ($i = 0; $i -lt 240; $i++) {\n      if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) { break }\n      Start-Sleep -Milliseconds 500\n    }\n    if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Fail 'APP_STILL_RUNNING' }\n  }\n  Start-Sleep -Milliseconds 800\n  Stop-JinbaoChildren -StateDir $From\n\n  $item = Get-Item -LiteralPath $From -Force -ErrorAction Stop\n  if ($item.LinkType) { Fail 'ALREADY_MIGRATED' }\n  if (-not (Test-Path -LiteralPath $To)) {\n    New-Item -ItemType Directory -Path $To -Force | Out-Null\n  } elseif ((Get-ChildItem -LiteralPath $To -Force | Measure-Object).Count -gt 0) {\n    Fail 'TARGET_NOT_EMPTY'\n  }\n\n  $rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(\n    $From, $To, '/MIR', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NP'\n  ) -Wait -PassThru -WindowStyle Hidden\n  Write-Log ('robocopy exit=' + $rc.ExitCode)\n  if ($rc.ExitCode -ge 8) { Fail ('COPY_FAILED_' + $rc.ExitCode) }\n\n  $old = $From + '.migrate-old-' + (Get-Date -Format 'yyyyMMddHHmmss')\n  Rename-Item -LiteralPath $From -NewName (Split-Path $old -Leaf)\n  try {\n    New-Item -ItemType Junction -Path $From -Target $To | Out-Null\n    if (-not (Test-Path -LiteralPath (Join-Path $From 'launcher-state.json'))) { Fail 'JUNCTION_VERIFY_FAILED' }\n  } catch {\n    if (Test-Path -LiteralPath $From) { Remove-Item -LiteralPath $From -Force -Recurse -ErrorAction SilentlyContinue }\n    if (Test-Path -LiteralPath $old) { Rename-Item -LiteralPath $old -NewName (Split-Path $From -Leaf) }\n    throw\n  }\n  Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue\n  Write-Log 'migrated ok'\n  if ($Launcher -and (Test-Path -LiteralPath $Launcher)) {\n    Start-Process -FilePath $Launcher -WorkingDirectory (Split-Path $Launcher -Parent)\n    Write-Log 'launcher started'\n  }\n} catch {\n  Write-Log ('error: ' + $_.Exception.Message)\n  throw\n}\n";

const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const STORAGE_DEFAULTS = Object.freeze({
  memoryDays: 30,
  memoryMaxFiles: 300,
  memoryMaxBytes: 300 * MB,
  logsDays: 14,
  logsMaxBytes: 400 * MB,
  legacyDays: 14,
  keepReleases: 2,
  keepActiveMs: 10 * 60 * 1000,
});

async function dirSizes(dir, seen = new Set()) {
  let bytes = 0;
  let files = 0;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return { bytes: 0, files: 0 }; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = await dirSizes(path, seen);
      bytes += inner.bytes;
      files += inner.files;
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const info = await stat(path);
      files += 1;
      // 更新包里的 node.exe 是硬链接：同一个 inode 只算一次，避免占用被放大。
      if (info.nlink > 1 && Number.isFinite(Number(info.ino)) && Number(info.ino) !== 0) {
        const key = String(info.dev) + ':' + String(info.ino);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      bytes += info.size;
    } catch {}
  }
  return { bytes, files };
}

function versionParts(name) {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(name);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersionDesc(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

function envelopeVersion(envelope) {
  try {
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    return typeof payload?.version === 'string' ? payload.version : null;
  } catch { return null; }
}

export function createStorageMaintenance({ stateDir, launcherPath = '', now = () => Date.now(), limits = {} } = {}) {
  const config = { ...STORAGE_DEFAULTS, ...limits };
  const updatesDir = join(stateDir, 'updates');
  const releasesDir = join(updatesDir, 'releases');
  const memoryDir = join(stateDir, 'game-memory');
  const logsDir = join(stateDir, 'logs');
  const highlightsDir = join(stateDir, 'highlights');

  async function releaseKeepSet() {
    const keep = new Set();
    const launcher = await readJson(join(stateDir, 'launcher-state.json'));
    const current = String(launcher?.version ?? '').match(/^(\d+\.\d+\.\d+)/)?.[1];
    if (current) keep.add('v' + current);
    for (const name of ['pending', 'active', 'previous']) {
      const envelope = await readJson(join(updatesDir, name + '.json'));
      const version = envelope ? envelopeVersion(envelope) : null;
      if (version) keep.add('v' + version);
    }
    let entries = [];
    try { entries = await readdir(releasesDir, { withFileTypes: true }); } catch { return keep; }
    const versions = entries
      .filter(entry => entry.isDirectory() && versionParts(entry.name))
      .map(entry => ({ name: entry.name, parts: versionParts(entry.name) }))
      .sort((a, b) => compareVersionDesc(a.parts, b.parts));
    for (const row of versions.slice(0, config.keepReleases)) keep.add(row.name);
    return keep;
  }

  async function pruneReleases() {
    let entries = [];
    try { entries = await readdir(releasesDir, { withFileTypes: true }); } catch { return { removed: 0, bytes: 0, kept: [] }; }
    const keep = await releaseKeepSet();
    let removed = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !versionParts(entry.name)) continue;
      if (keep.has(entry.name)) continue;
      const path = join(releasesDir, entry.name);
      const size = await dirSizes(path);
      try {
        await rm(path, { recursive: true, force: true });
        removed += 1;
        bytes += size.bytes;
      } catch {}
    }
    return { removed, bytes, kept: [...keep].sort() };
  }

  async function pruneMemory() {
    let entries = [];
    try { entries = await readdir(memoryDir, { withFileTypes: true }); } catch { return { removed: 0, bytes: 0 }; }
    const cutoff = now() - config.memoryDays * DAY;
    const rows = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const path = join(memoryDir, entry.name);
      try { rows.push({ path, info: await stat(path) }); } catch {}
    }
    rows.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    let removed = 0;
    let bytes = 0;
    let keptBytes = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const fits = keptBytes + row.info.size <= config.memoryMaxBytes;
      const keep = row.info.mtimeMs >= cutoff && index < config.memoryMaxFiles && fits;
      if (keep) { keptBytes += row.info.size; continue; }
      try {
        await rm(row.path, { force: true });
        removed += 1;
        bytes += row.info.size;
      } catch {}
    }
    return { removed, bytes };
  }

  async function pruneLogs() {
    let entries = [];
    try { entries = await readdir(logsDir, { withFileTypes: true }); } catch { return { removed: 0, bytes: 0 }; }
    const cutoff = now() - config.logsDays * DAY;
    const activeAfter = now() - config.keepActiveMs;
    const rows = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const path = join(logsDir, entry.name);
      try { rows.push({ path, info: await stat(path) }); } catch {}
    }
    let total = rows.reduce((sum, row) => sum + row.info.size, 0);
    let removed = 0;
    let bytes = 0;
    for (const row of rows.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
      if (row.info.mtimeMs > activeAfter) continue;
      const expired = row.info.mtimeMs < cutoff;
      const oversized = total > config.logsMaxBytes;
      if (!expired && !oversized) continue;
      try {
        await rm(row.path, { force: true });
        removed += 1;
        bytes += row.info.size;
        total -= row.info.size;
      } catch {}
    }
    return { removed, bytes };
  }

  async function pruneLegacy() {
    let removed = 0;
    let bytes = 0;
    const cutoff = now() - config.legacyDays * DAY;
    const targets = [
      join(stateDir, 'logs-archive-stale'),
      join(stateDir, 'logs-archive'),
    ];
    let entries = [];
    try { entries = await readdir(stateDir, { withFileTypes: true }); } catch {}
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('card-watch-')) targets.push(join(stateDir, entry.name));
    }
    let staging = [];
    try { staging = await readdir(updatesDir, { withFileTypes: true }); } catch {}
    for (const entry of staging) {
      if (entry.isDirectory() && entry.name.startsWith('staging-')) targets.push(join(updatesDir, entry.name));
    }
    for (const path of targets) {
      try {
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          const size = await dirSizes(path);
          await rm(path, { recursive: true, force: true });
          removed += 1;
          bytes += size.bytes;
        }
      } catch {}
    }
    return { removed, bytes };
  }

  async function report() {
    const [updates, memory, logs, highlights, legacy] = await Promise.all([
      dirSizes(releasesDir).then(async releases => {
        let versions = 0;
        try { versions = (await readdir(releasesDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).length; } catch {}
        return { ...releases, versions };
      }),
      dirSizes(memoryDir),
      dirSizes(logsDir),
      dirSizes(highlightsDir),
      dirSizes(join(stateDir, 'logs-archive-stale')),
    ]);
    const totalBytes = updates.bytes + memory.bytes + logs.bytes + highlights.bytes + legacy.bytes;
    return {
      stateDir,
      totalBytes,
      categories: { updates, memory, logs, highlights, legacy },
      limits: { ...config },
      at: now(),
    };
  }

  async function cleanup(target = 'all') {
    const reportBefore = await report();
    const result = {};
    if (target === 'all' || target === 'releases') result.releases = await pruneReleases();
    if (target === 'all' || target === 'memory') result.memory = await pruneMemory();
    if (target === 'all' || target === 'logs') result.logs = await pruneLogs();
    if (target === 'all' || target === 'legacy') result.legacy = await pruneLegacy();
    const reportAfter = await report();
    const freedBytes = Math.max(0, reportBefore.totalBytes - reportAfter.totalBytes);
    return { target, result, freedBytes, before: reportBefore, after: reportAfter };
  }

  async function migrate(target) {
    const from = resolve(stateDir);
    const to = resolve(String(target ?? '').trim());
    if (!String(target ?? '').trim()) throw Object.assign(Error('请选择迁移目标目录'), { status: 400 });
    if (to === from) throw Object.assign(Error('目标目录不能和当前目录相同'), { status: 400 });
    if (to.startsWith(from + sep) || from.startsWith(to + sep)) throw Object.assign(Error('目标目录不能和当前目录互相包含'), { status: 400 });
    let fromInfo;
    try { fromInfo = await lstat(from); } catch { throw Object.assign(Error('当前数据目录不存在'), { status: 409 }); }
    if (fromInfo.isSymbolicLink()) throw Object.assign(Error('数据目录已经迁移过了'), { status: 409 });
    let toInfo = null;
    try { toInfo = await stat(to); } catch {}
    if (toInfo) {
      if (!toInfo.isDirectory()) throw Object.assign(Error('目标路径不是文件夹'), { status: 400 });
      const entries = await readdir(to);
      if (entries.length) throw Object.assign(Error('目标文件夹不是空的，请换一个空目录'), { status: 409 });
    }
    const need = (await dirSizes(from)).bytes;
    try {
      const space = await statfs(parse(to).root);
      const freeBytes = Number(space.bavail) * Number(space.bsize);
      if (Number.isFinite(freeBytes) && freeBytes > 0 && freeBytes < need * 1.2) {
        throw Object.assign(Error('目标磁盘剩余空间不足（还需要约 ' + Math.ceil((need * 1.2) / MB) + ' MB）'), { status: 409 });
      }
    } catch (error) {
      if (error.status) throw error;
    }
    const helper = join(stateDir, 'updates', 'storage-migrate.ps1');
    await mkdir(dirname(helper), { recursive: true });
    await writeFile(helper, '\uFEFF' + MIGRATION_SCRIPT, { mode: 0o600 });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-From', from, '-To', to, '-WaitPid', String(process.pid)];
    if (launcherPath) args.push('-Launcher', launcherPath);
    // 直接用 spawn 会被启动器的 Job Object 在退出时一并杀掉，改用 WMI 创建进程（跑到 Job 之外）。
    const commandLine = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"' + helper + '"', '-From', '"' + from + '"', '-To', '"' + to + '"', '-WaitPid', String(process.pid)]
      .concat(launcherPath ? ['-Launcher', '"' + launcherPath + '"'] : []).join(' ');
    const create = '$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=' + JSON.stringify(commandLine) + '}; if(-not $r -or $r.ReturnValue -ne 0){Write-Error ("WMI " + $r.ReturnValue); exit 1}';
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', create], { windowsHide: true, timeout: 15000 });
    return { ok: true, from, to, message: '正在退出金宝并迁移数据，完成后会自动重新启动。' };
  }

  return { report, cleanup, migrate };
}
