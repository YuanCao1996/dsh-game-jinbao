// 高光截图：每局最多 6 张，由关键事件触发，存在本机，不上传。
//
// 采集复用已有的 capture-game.ps1（同一份截图能力，返回 image/jpeg + base64）。
// 索引写在 highlights/index.jsonl，探索页对局详情据此列出缩略图。
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const HIGHLIGHT_LIMIT_PER_MATCH = 6;
export const HIGHLIGHT_MIN_GAP_MS = 10_000;
export const HIGHLIGHT_KEEP_DAYS = 30;

// 哪些事件值得留下画面：多杀、团灭、破水晶、大龙、首杀、连死后的复活
export const HIGHLIGHT_KINDS = Object.freeze({
  Multikill: '多杀',
  Ace: '团灭',
  InhibKilled: '破水晶',
  BaronKill: '大龙',
  DragonKill: '小龙',
  FirstBlood: '首杀',
});

export function shouldCapture(event) {
  const name = String(event?.name ?? event?.EventName ?? '');
  if (!HIGHLIGHT_KINDS[name]) return false;
  if (name === 'Multikill' && Number(event?.KillStreak ?? event?.killStreak ?? 0) < 3) return false;
  return true;
}

// 对局标识直接当目录名不安全（含 # 与扩展名），统一替换成短哈希式名字
export function matchFolder(match) {
  const raw = String(match ?? '').replace(/#\d+$/, '');
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}

export function createHighlights({ stateDir, capture, enabled = () => true, now = () => Date.now(), limit = HIGHLIGHT_LIMIT_PER_MATCH }) {
  const root = join(stateDir, 'highlights');
  const indexFile = join(root, 'index.jsonl');
  const perMatch = new Map();
  let indexCache = null;

  const defaultCapture = async game => {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('../dsh-coach-server/capture-game.ps1', import.meta.url)), '-Game', game, '-StateDir', stateDir,
    ], { windowsHide: true, timeout: 12000, maxBuffer: 1_200_000 });
    return JSON.parse(String(stdout ?? '').replace(/^\uFEFF/, ''));
  };
  const grab = capture ?? defaultCapture;

  const loadIndex = async () => {
    if (indexCache) return indexCache;
    try {
      indexCache = (await readFile(indexFile, 'utf8')).split('\n').filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    } catch { indexCache = []; }
    return indexCache;
  };

  return {
    // 由事件驱动：命中关键事件时截一张，超限就跳过
    async maybeCapture({ event, game, match, gameSeconds }) {
      if (!enabled() || !shouldCapture(event)) return null;
      const key = String(match ?? '');
      if (!key) return null;
      const state = perMatch.get(key) ?? { count: 0, lastAt: 0 };
      if (state.count >= limit) return null;
      if (now() - state.lastAt < HIGHLIGHT_MIN_GAP_MS) return null;

      let frame;
      try { frame = await grab(game); } catch { return null; }
      if (!frame?.available || frame.mediaType !== 'image/jpeg' || !frame.data) return null;

      const kind = String(event?.name ?? event?.EventName ?? 'event');
      const folder = matchFolder(key);
      const dir = join(root, folder);
      await mkdir(dir, { recursive: true });
      const seq = state.count + 1;
      const name = `${String(seq).padStart(2, '0')}-${kind}.jpg`;
      await writeFile(join(dir, name), Buffer.from(frame.data, 'base64'), { mode: 0o600 });

      const entry = {
        at: now(), game: String(game ?? 'lol'), match: key, folder,
        file: name, kind, label: HIGHLIGHT_KINDS[kind] ?? kind,
        gameSeconds: Number.isFinite(Number(gameSeconds)) ? Number(gameSeconds) : null,
        bytes: Buffer.from(frame.data, 'base64').length,
      };
      await appendFile(indexFile, JSON.stringify(entry) + '\n', { mode: 0o600 });
      indexCache = null;
      state.count = seq;
      state.lastAt = entry.at;
      perMatch.set(key, state);
      return entry;
    },
    async list(match) {
      const rows = await loadIndex();
      return rows.filter(row => !match || row.match === match);
    },
    // 30 天自动清理：只删索引里的旧文件，不碰其它目录
    async prune() {
      const rows = await loadIndex();
      const cutoff = now() - HIGHLIGHT_KEEP_DAYS * 24 * 60 * 60 * 1000;
      const keep = [];
      for (const row of rows) {
        if (row.at >= cutoff) { keep.push(row); continue; }
        try { await writeFile(join(root, row.folder, row.file), ''); } catch {}
      }
      return rows.length - keep.length;
    },
  };
}
