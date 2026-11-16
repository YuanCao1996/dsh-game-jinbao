// 「未了线」：她记着但还没兑现的事。
// 来源只有两种真实数据：她日记里写下的那句（line），和玩家自己在游戏里说过的「明天/下次/等会…」。
// 存下来的每一条只用一次，一周最多用两次——记性要好，但不能变成复读机。
import { createHash } from 'node:crypto';

const PROMISE = /(明天|下次|等会|一会儿|回头|等下|周末|晚上|改天)[^。！？!?]{0,18}/;
const idOf = (kind, text) => createHash('sha256').update(kind + '|' + text).digest('hex').slice(0, 16);

export function promiseThreads(selfChats = [], day) {
  const out = [];
  for (const raw of Array.isArray(selfChats) ? selfChats : []) {
    const text = String(raw ?? '').trim();
    if (!text || [...text].length < 4) continue;
    const match = PROMISE.exec(text);
    if (!match) continue;
    const phrase = match[1] + (match[0].slice(match[1].length) || '');
    out.push({ id: idOf('promise', phrase), kind: 'promise', text: phrase.trim().slice(0, 24), day });
  }
  return out;
}

export const lineThread = entry => (entry?.line
  ? [{ id: idOf('line', entry.line), kind: 'line', text: String(entry.line).slice(0, 24), day: entry.day }]
  : []);

export function mergeThreads(existing = [], incoming = [], { keep = 40 } = {}) {
  const byId = new Map();
  for (const thread of [...existing, ...incoming]) {
    if (!thread?.id || !thread.text) continue;
    const previous = byId.get(thread.id);
    if (!previous) { byId.set(thread.id, thread); continue; }
    // 已在旧记录里用过的，不能被新记录洗掉（同一句话不重复提）。
    byId.set(thread.id, { ...previous, ...thread, usedAt: thread.usedAt ?? previous.usedAt });
  }
  return [...byId.values()].slice(-keep);
}

// 到期：还没用过、不太旧、并且最近 7 天用得还没超额度。
export function dueThreads(threads = [], { now = Date.now(), weekLimit = 2, maxAgeDays = 21 } = {}) {
  const fresh = (Array.isArray(threads) ? threads : []).filter(thread => thread?.text && !thread.usedAt);
  const usedRecently = (Array.isArray(threads) ? threads : []).filter(thread => Number(thread.usedAt) > now - 7 * 86400e3);
  if (usedRecently.length >= weekLimit) return [];
  return fresh
    .filter(thread => !Number.isFinite(thread.at) || now - Number(thread.at) <= maxAgeDays * 86400e3)
    .sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0));
}

// 周回顾用的一句「洞察」：只在她真的能看出来的时候才说（样本不够宁可不说）。
export function insightFor(rows = [], { now = Date.now(), minSample = 4 } = {}) {
  const matches = (Array.isArray(rows) ? rows : [])
    .filter(row => Number.isFinite(Number(row?.at)) && now - Number(row.at) <= 14 * 86400e3 && (row.result === 'win' || row.result === 'lose'))
    .sort((a, b) => Number(a.at) - Number(b.at));
  if (matches.length < minSample) return null;

  // 1) 连败之后的下一局
  let after = { win: 0, total: 0 }, streak = 0;
  for (let index = 0; index < matches.length; index++) {
    const row = matches[index];
    if (index > 0 && streak >= 2) { after.total++; if (row.result === 'win') after.win++; }
    streak = row.result === 'lose' ? streak + 1 : 0;
  }
  if (after.total >= minSample) {
    const rate = after.win / after.total;
    if (rate >= 0.6) return `他连输两场之后的那一局，反而更容易赢（${after.win}/${after.total}）`;
    if (rate <= 0.25) return `他连输两场之后再开一局，几乎都还是输（${after.win}/${after.total}）`;
  }

  // 2) 第一局 vs 后面的局
  const byDay = new Map();
  for (const row of matches) {
    const day = new Date(Number(row.at)).toDateString();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(row);
  }
  let first = { win: 0, total: 0 }, later = { win: 0, total: 0 };
  for (const list of byDay.values()) {
    list.forEach((row, index) => {
      const bucket = index === 0 ? first : later;
      bucket.total++; if (row.result === 'win') bucket.win++;
    });
  }
  if (first.total >= minSample && later.total >= minSample) {
    const gap = first.win / first.total - later.win / later.total;
    if (gap >= 0.25) return `他每天第一局赢得比后面几局多（${first.win}/${first.total} 对 ${later.win}/${later.total}）`;
    if (gap <= -0.25) return `他每天第一局总是输，后面才慢慢打热（${first.win}/${first.total} 对 ${later.win}/${later.total}）`;
  }
  return null;
}
