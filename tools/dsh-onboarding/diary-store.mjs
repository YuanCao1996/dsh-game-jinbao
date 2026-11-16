// 日记的本地存储：全部在 stateDir/diary 下，不上传。索引单独一份，正文一天一个文件。
import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOODS = new Set(['得意', '平静', '心虚', '想念', '犯困']);

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function atomicJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

// 正文里出现的换行只保留段落分隔，别把奇怪的空白写进页面。
const normalizeBody = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export function createDiaryStore({ stateDir }) {
  const root = join(stateDir, 'diary');
  const indexPath = join(root, 'entries.json');
  const settingsPath = join(root, 'settings.json');
  const linesPath = join(root, 'lines.json');
  const entryPath = day => join(root, day + '.json');

  async function index() {
    const rows = await readJson(indexPath, []);
    return Array.isArray(rows) ? rows.filter(row => row && DAY.test(String(row.day ?? ''))) : [];
  }

  return {
    root,
    async settings() {
      const saved = await readJson(settingsPath, {});
      return { enabled: saved?.enabled !== false };
    },
    async setSettings(patch = {}) {
      const current = await this.settings();
      const next = { ...current, ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}) };
      await atomicJson(settingsPath, next);
      return next;
    },
    async list({ limit = 120 } = {}) {
      const rows = await index();
      return rows.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, Math.max(1, Math.min(500, limit)));
    },
    async count() { return (await index()).length; },
    async get(day) {
      if (!DAY.test(String(day ?? ''))) return null;
      const entry = await readJson(entryPath(day), null);
      if (!entry || entry.day !== day) return null;
      return { ...entry, paragraphs: Array.isArray(entry.paragraphs) && entry.paragraphs.length ? entry.paragraphs : normalizeBody(entry.body).split(/\n{2,}/).filter(Boolean) };
    },
    async save(entry) {
      const day = String(entry?.day ?? '');
      if (!DAY.test(day)) throw Error('Invalid diary day');
      const body = normalizeBody(entry.body);
      if (!body) throw Error('Empty diary body');
      if ([...body].length > 600) throw Error('Diary body too long');
      const record = {
        version: 1, day, at: Number(entry.at) || Date.now(),
        title: String(entry.title ?? '').trim().slice(0, 20) || day,
        body, paragraphs: body.split(/\n{2,}/).filter(Boolean),
        mood: MOODS.has(entry.mood) ? entry.mood : '平静',
        line: String(entry.line ?? '').trim().slice(0, 20),
        chars: [...body.replace(/\s+/g, '')].length,
        role: String(entry.role ?? '金宝').slice(0, 12),
        topic: String(entry.topic ?? '').slice(0, 24),
        score: Number(entry.score) || 0,
      };
      await atomicJson(entryPath(day), record);
      const rows = (await index()).filter(row => row.day !== day);
      rows.push({ day, at: record.at, title: record.title, mood: record.mood, chars: record.chars, role: record.role, hasLine: !!record.line });
      await atomicJson(indexPath, rows.sort((a, b) => (a.day < b.day ? 1 : -1)));
      return record;
    },
    async remove(day) {
      if (!DAY.test(String(day ?? ''))) return false;
      await rm(entryPath(day), { force: true });
      const rows = (await index()).filter(row => row.day !== day);
      await atomicJson(indexPath, rows);
      return true;
    },
    async removeAll() {
      let names = [];
      try { names = await readdir(root); } catch { return 0; }
      let removed = 0;
      for (const name of names) {
        if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
        await rm(join(root, name), { force: true });
        removed++;
      }
      await atomicJson(indexPath, []);
      return removed;
    },
    // 「她昨天惦记的那句话」：只取最近一篇还没用过的，且一周最多用两次。
    async pendingLine({ today, weekLimit = 2 } = {}) {
      const rows = (await index()).filter(row => row.hasLine && String(row.day) < String(today)).sort((a, b) => (a.day < b.day ? 1 : -1));
      for (const row of rows) {
        const entry = await readJson(entryPath(row.day), null);
        if (!entry?.line || entry.lineUsedAt) continue;
        const usage = await readJson(linesPath, { at: [] });
        const recent = (Array.isArray(usage?.at) ? usage.at : []).filter(at => Number(at) > Date.now() - 7 * 86400e3);
        if (recent.length >= weekLimit) return null;
        return { day: entry.day, text: entry.line };
      }
      return null;
    },
    async markLineUsed(day, at = Date.now()) {
      const entry = await readJson(entryPath(day), null);
      if (!entry) return false;
      await atomicJson(entryPath(day), { ...entry, lineUsedAt: at });
      const usage = await readJson(linesPath, { at: [] });
      const list = (Array.isArray(usage?.at) ? usage.at : []).filter(value => Number(value) > at - 30 * 86400e3);
      list.push(at);
      await atomicJson(linesPath, { at: list.slice(-20) });
      return true;
    },
  };
}
