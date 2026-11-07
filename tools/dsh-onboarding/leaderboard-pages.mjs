// 等待态的两页「总榜」与列排版工具。
//
// 设计取舍：跨列对齐依赖等宽字体与空格宽度，比例字体下必然漂移，因此行渲染采用
// 「品质 + 名称 · 胜率」的单行结构——只保留一个固定宽度的品质列，其余自然连写，
// 在任意字体下都不会错位。padDisplay/padDisplayLeft/alignedColumns 仍然导出，
// 供对局内列表等需要列对齐的地方复用。

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

/** 左侧补空格（数值右对齐）。 */
export function padDisplayLeft(text, width) {
  const value = String(text ?? '');
  const pad = width - displayWidth(value);
  return pad > 0 ? ' '.repeat(pad) + value : value;
}

/** 通用列：品质 · 名称 · 数值，按显示宽度补齐。 */
export function alignedColumns(tier, name, value, {nameWidth = 18, valueWidth = 6} = {}) {
  return (
    padDisplay(quality(tier), 3) + ' ' +
    padDisplay(String(name ?? '—'), nameWidth) + ' ' +
    padDisplayLeft(String(value ?? ''), valueWidth)
  ).trimEnd();
}

/** "封魔剑魂 永恩" → "永恩"。 */
function heroNameOnly(champion) {
  const text = String(champion ?? '').trim();
  if (!text) return '';
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : text;
}

/** 强化行：品质 · 名称 · 胜率 */
export function alignedAugmentRow(row) {
  const rate = row?.winRate != null && row.winRate !== '' ? pct(row.winRate) : '—';
  return alignedColumns(row?.tier, row?.name, rate);
}

/** 英雄行：品质 · 名称 · 胜率 */
export function alignedHeroRow(row) {
  const rate = row?.winRate != null && row.winRate !== '' ? pct(row.winRate) : '—';
  return alignedColumns(row?.tier, row?.name ?? row?.champion, rate);
}

const byWinRate = (a, b) => (num(b?.winRate) ?? -1) - (num(a?.winRate) ?? -1);

/** 去重（整榜是"强化 × 英雄"组合，同名会重复）+ 按胜率降序 + 截断。 */
function uniqueByWinRate(rows, limit) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  const seen = new Map();
  for (const row of list.slice().sort(byWinRate)) {
    const key = String(row.name ?? '');
    if (key && !seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()].slice(0, limit);
}

/** 整理成可直接渲染的行数据（表格用）。 */
export function leaderboardRowData(rows, {limit = 10, withChampion = false} = {}) {
  return uniqueByWinRate(rows, limit).map((row) => ({
    tier: quality(row.tier),
    name: String(row.name ?? '—'),
    winRate: pct(row.winRate),
    ...(withChampion ? {champion: heroNameOnly(row.champion)} : {}),
  }));
}

/** 单行：品质 + 名称 · 胜率 */
const singleRow = (row) => padDisplay(quality(row?.tier), 3) + ' ' + String(row?.name ?? '—') + ' · ' + pct(row?.winRate);

export function hextechLeaderboardPage(rows, { limit = 10 } = {}) {
  const list = uniqueByWinRate(rows, limit);
  if (!list.length) return '';
  const lines = ['通用 Top 海克斯 · 总榜', '快照数据 · 进对局自动切换为本局英雄'];
  for (const row of list) lines.push(singleRow(row));
  return lines.join('\n');
}

export function heroLeaderboardPage(rows, { limit = 10 } = {}) {
  const list = uniqueByWinRate(rows, limit);
  if (!list.length) return '';
  const lines = ['英雄胜率总榜 · 大乱斗', '快照数据 · 进对局自动切换为双方英雄'];
  for (const row of list) lines.push(singleRow(row));
  return lines.join('\n');
}

/** 从英雄行里取"顶级符文"对应的强化 id。 */
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
