// 状态目录的磁盘维护：高光/日志/对局记忆/旧版本都有上限，避免无限增长。
// 只删本模块能确定是“可再生”或“过期”的文件，不动当前对局正在写的文件。
import { readdir, stat, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export function createStorageMaintenance({ stateDir, now = () => Date.now(), limits = {} } = {}) {
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

  return { report, cleanup };
}
