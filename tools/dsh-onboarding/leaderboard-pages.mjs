// 等待态的"总榜"两页渲染：海克斯榜与英雄胜率榜。
//
// 数据来自桌面网关的整榜接口（契约见 handoff/leaderboard-api.md）：
//   POST /desktop/agent-preview/knowledge
//   {game:'lol', query, dataset:'leaderboard', board:'hextech'|'heroes', limit:1..20}
//
// 两个约定：
// 1) 服务端返回的 rank 对海克斯榜来说只是"该强化在所属英雄内的排名"，各条都是 #1，
//    不能直接当榜单名次；这里统一按胜率降序重排、并重新编号。
// 2) 悬浮窗很窄，长行会被截断或挤在一起，所以每条用两行：首行名次+品质+名称，
//    次行把胜率/选取率/适配信息缩进对齐，读起来更整齐。

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const pct = (value, digits = 1) => {
  const n = num(value);
  return n === null ? '—' : n.toFixed(digits) + '%';
};

const quality = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).trim();
  return /^[Tt]/.test(text) ? text.toUpperCase() : 'T' + text;
};

/** 名次统一补成两位，行首对齐。 */
const rankText = (index) => (index + 1 < 10 ? ' 0' + (index + 1) : ' ' + (index + 1));

const byWinRate = (a, b) => (num(b?.winRate) ?? -1) - (num(a?.winRate) ?? -1);

export function hextechLeaderboardPage(rows, { limit = 10 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  if (!list.length) return '';
  const sorted = list.slice().sort(byWinRate).slice(0, limit);
  const lines = ['通用 Top 海克斯 · 总榜（等待开局）', '数据为快照口径；进入对局后切换为本局英雄'];
  sorted.forEach((row, index) => {
    lines.push(`#${rankText(index)} · ${quality(row.tier)} · ${row.name ?? '—'}`);
    const champion = typeof row.champion === 'string' && row.champion ? ' · 适配 ' + row.champion : '';
    lines.push(`       胜率 ${pct(row.winRate)} · 选取 ${pct(row.pickRate)}${champion}`);
  });
  return lines.join('\n');
}

export function heroLeaderboardPage(rows, { limit = 10, topRune } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  if (!list.length) return '';
  const sorted = list.slice().sort(byWinRate).slice(0, limit);
  const lines = ['英雄胜率总榜 · 大乱斗（等待开局）', '数据为快照口径；进入对局后切换为本局双方英雄'];
  sorted.forEach((row, index) => {
    const name = [row.name, row.title ? `「${row.title}」` : ''].filter(Boolean).join('') || '—';
    lines.push(`#${rankText(index)} · ${quality(row.tier)} · ${name}`);
    const rune = typeof topRune === 'function' ? topRune(row) : '';
    lines.push(`       胜率 ${pct(row.winRate)}${rune ? ' · 顶级符文 ' + rune : ''}`);
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
