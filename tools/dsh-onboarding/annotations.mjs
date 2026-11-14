// 对局批注：追加式存储，不修改历史（用户明确要求）。
//
// 每条批注挂在某一局上，可以指向整局、某条播报或某个瞬间。
// 后续会被吸收进用户偏好（即时层/画像层/记忆层），所以字段保持稳定、可聚合。
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ANNOTATION_TAGS = Object.freeze([
  '很有用', '太啰嗦', '别念英文', '出装不对', '夸得不错', '这局别复盘', '想打输出', '想稳一点',
]);

const LIMITS = { text: 200, tags: 4, total: 2000 };

export function createAnnotations({ stateDir, now = () => Date.now() }) {
  const file = join(stateDir, 'annotations.jsonl');
  let cache = null;

  const load = async () => {
    if (cache) return cache;
    try {
      const raw = await readFile(file, 'utf8');
      cache = raw.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    } catch { cache = []; }
    return cache;
  };

  const normalize = value => {
    const tags = Array.isArray(value?.tags)
      ? [...new Set(value.tags.map(tag => String(tag).trim()).filter(tag => ANNOTATION_TAGS.includes(tag)))].slice(0, LIMITS.tags)
      : [];
    const text = String(value?.text ?? '').trim().slice(0, LIMITS.text);
    const target = value?.target && typeof value.target === 'object'
      ? { kind: ['match', 'broadcast', 'moment'].includes(value.target.kind) ? value.target.kind : 'match', id: String(value.target.id ?? '').slice(0, 80) }
      : { kind: 'match', id: '' };
    return {
      at: now(),
      game: String(value?.game ?? 'lol').slice(0, 16),
      match: String(value?.match ?? '').slice(0, 120),
      champion: String(value?.champion ?? '').slice(0, 24),
      target,
      text,
      tags,
      sentiment: value?.sentiment === 'negative' ? 'negative' : value?.sentiment === 'positive' ? 'positive' : 'neutral',
    };
  };

  return {
    async add(value) {
      const entry = normalize(value);
      if (!entry.match) throw Object.assign(Error('缺少对局标识'), { status: 400 });
      if (!entry.text && !entry.tags.length) throw Object.assign(Error('批注内容不能为空'), { status: 400 });
      await mkdir(stateDir, { recursive: true });
      await appendFile(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
      cache = null;
      return entry;
    },
    async list({ match, champion, limit = LIMITS.total } = {}) {
      const rows = await load();
      return rows
        .filter(row => (!match || row.match === match) && (!champion || row.champion === champion))
        .slice(-limit);
    },
    async count(champion) {
      return (await this.list({ champion })).length;
    },
  };
}
