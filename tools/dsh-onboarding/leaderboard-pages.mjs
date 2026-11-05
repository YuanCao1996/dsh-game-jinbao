// 等待态的"总榜"两页：海克斯榜与英雄胜率榜。
//
// 数据来自桌面网关的整榜接口（契约见 handoff/leaderboard-api.md）。
// 展示要求（按用户口味）：每条一行、不要排名数字与井号、不要选取率、不要"适配"二字、
// 英雄只显示名字（不带称号），并且各列必须对齐。
//
// 对齐要点：中文占两列宽，所以按"显示宽度"补空格，而不是按字符个数。

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const pct = (value) => {
  const n = num(value);
  return n === null ? '—' : n.toFixed(1) + '%';
};

const quality = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).trim();
  return /^[Tt]/.test(text) ? text.toUpperCase() : 'T' + text;
};

/** 显示宽度：全角/中文按 2 列算。 */
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0x2e80 && code < 0xff65 ? 2 : 1;
  }
  return width;
}

/** 按显示宽度右侧补空格。 */
export function padDisplay(text, width) {
  const value = String(text ?? '');
  const pad = width - displayWidth(value);
  return pad > 0 ? value + ' '.repeat(pad) : value;
}

/** "封魔剑魂 永恩" → "永恩"：只留英雄本名，去掉称号。 */
function heroNameOnly(champion) {
  const text = String(champion ?? '').trim();
  if (!text) return '';
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : text;
}

const byWinRate = (a, b) => (num(b?.winRate) ?? -1) - (num(a?.winRate) ?? -1);

export function hextechLeaderboardPage(rows, { limit = 10 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  if (!list.length) return '';
  const sorted = list.slice().sort(byWinRate).slice(0, limit);
  const lines = ['通用 Top 海克斯 · 总榜（等待开局）', '数据为快照口径；进入对局后切换为本局英雄'];
  sorted.forEach((row) => {
    lines.push((
      padDisplay(quality(row.tier), 3) + ' ' +
      padDisplay(row.name ?? '—', 18) + ' ' +
      padDisplay(pct(row.winRate), 6) + ' ' +
      heroNameOnly(row.champion)
    ).trimEnd());
  });
  return lines.join('\n');
}

export function heroLeaderboardPage(rows, { limit = 10, topRune } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  if (!list.length) return '';
  const sorted = list.slice().sort(byWinRate).slice(0, limit);
  const lines = ['英雄胜率总榜 · 大乱斗（等待开局）', '数据为快照口径；进入对局后切换为本局双方英雄'];
  sorted.forEach((row) => {
    const rune = typeof topRune === 'function' ? String(topRune(row) ?? '') : '';
    lines.push((
      padDisplay(quality(row.tier), 3) + ' ' +
      padDisplay(row.name ?? '—', 18) + ' ' +
      padDisplay(pct(row.winRate), 6) + ' ' +
      rune
    ).trimEnd());
  });
  return lines.join('\n');
}

/** 从英雄行里取"顶级符文"对应的强化 id（augmentStats 可能是 JSON 字符串或数组）。 */
export function topRuneId(row) {
  if (!row) return null;
  let stats = row.augmentStats;
  if (typeof stats === 'string') {
    try {
      stats = JSON.parse(stats);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(stats) || !stats.length) return null;
  const first = stats.slice().sort((a, b) => (num(a?.rank) ?? 999) - (num(b?.rank) ?? 999))[0];
  const id = num(first?.augmentId);
  return id === null ? null : id;
}
