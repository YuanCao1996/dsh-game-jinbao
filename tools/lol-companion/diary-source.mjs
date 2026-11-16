// 汇总「某一天发生了什么」：只读本机落盘的数据，不联网。
// 玩家在游戏里自己打的字来自 chat_events（self=true），这是最像「主动聊天」的素材。
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dayKey, dayRange, shiftDay, DAY_CUTOFF_HOURS } from './diary-day.mjs';

const ACE_KINDS = new Set(['Ace', 'Penta', 'Quadra', 'Triple']);

async function readJsonl(path) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* 半截行直接跳过 */ }
  }
  return rows;
}

export const resultOf = value => (value === 'win' || value === 'victory' ? 'win' : value === 'lose' || value === 'defeat' ? 'lose' : null);

// 只留「他说的那半句话」：去掉说话人前缀与换行，压平空白。
export function chatLine(text) {
  return String(text ?? '')
    .replace(/^[^：:]{1,16}[：:]\s*/, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 40);
}

export async function collectDay({ stateDir, day, query, maxMatches = 6, maxChats = 6, cutoffHours = DAY_CUTOFF_HOURS }) {
  const { from, to } = dayRange(day);
  const inDay = row => Number(row?.at) >= from && Number(row?.at) < to;
  const history = await readJsonl(join(stateDir, 'game-memory', 'match-history.jsonl'));
  const matches = [];
  for (const row of history.filter(inDay)) {
    if (!row || typeof row.match !== 'string') continue;
    matches.push({
      match: row.match,
      game: row.game === 'wzry' || row.game === 'generic' ? row.game : 'lol',
      champion: typeof row.champion === 'string' ? row.champion : '',
      result: resultOf(row.result),
      seconds: Number.isFinite(row.seconds) ? row.seconds : null,
      kda: row.kda && typeof row.kda === 'object' ? { k: Number(row.kda.k) || 0, d: Number(row.kda.d) || 0, a: Number(row.kda.a) || 0 } : null,
      augments: Number(row.augments) || 0,
      adviceRevoked: Number(row?.advice?.revoked) || 0,
      advicePublished: Number(row?.advice?.published) || 0,
    });
  }

  // 玩家自己打的字（含队聊与信号）：最多取前几局，够用即可。
  const selfChats = [];
  if (typeof query === 'function') {
    for (const row of matches.slice(0, maxMatches)) {
      if (selfChats.length >= maxChats) break;
      let page;
      try { page = await query({ game: row.game, match: row.match, kind: 'chat_events', limit: 40 }); } catch { continue; }
      for (const record of page?.rows ?? []) {
        const event = record?.event ?? record;
        for (const child of Array.isArray(event?.events) ? event.events : []) {
          if (child?.self !== true || typeof child.text !== 'string') continue;
          const text = chatLine(child.text);
          if (text && !selfChats.includes(text)) selfChats.push(text);
          if (selfChats.length >= maxChats) break;
        }
        if (selfChats.length >= maxChats) break;
      }
    }
  }

  const highlights = (await readJsonl(join(stateDir, 'highlights', 'index.jsonl'))).filter(inDay);
  const aces = highlights.filter(row => ACE_KINDS.has(String(row?.kind ?? ''))).length;

  // 她自己当天说过的话：写日记时用来「回忆自己」。
  const herLines = (await readJsonl(join(stateDir, 'local-moments.jsonl')))
    .filter(inDay)
    .map(row => String(row?.broadcast ?? '').trim())
    .filter(Boolean)
    .slice(-3);

  // 玩家主动在应用里问过几次：main 里每收到一条手动提问就记一行。
  let appChats = 0;
  try {
    const text = await readFile(join(stateDir, 'diary', `questions-${day}.jsonl`), 'utf8');
    appChats = text.split('\n').filter(line => line.trim()).length;
  } catch { appChats = 0; }

  // 隔了几天才再见面：用之前最近一局所在的那一天算。
  let gapDays = 0;
  const earlier = history.filter(row => Number(row?.at) < from);
  if (earlier.length) {
    const lastAt = Math.max(...earlier.map(row => Number(row.at) || 0));
    const lastDay = dayKey(lastAt, cutoffHours);
    const diff = Math.round((dayRange(day).from - dayRange(lastDay).from) / 86400e3);
    if (Number.isFinite(diff) && diff > 0) gapDays = diff;
  }

  // 两个「无用但具体」的细节来源：连续第几天来玩、今天有没有他第一次用的英雄。
  const playedDays = new Set(history.map(row => dayKey(Number(row.at), cutoffHours)));
  let streakDays = 0;
  for (let back = 0; back < 30; back++) {
    if (!playedDays.has(shiftDay(day, -back))) break;
    streakDays++;
  }
  const before = new Set(history.filter(row => Number(row.at) < from).map(row => String(row.champion ?? '')).filter(Boolean));
  const firstTimeChampions = matches.map(row => row.champion).filter(name => name && !before.has(name));

  const wins = matches.filter(row => row.result === 'win').length;
  const losses = matches.filter(row => row.result === 'lose').length;
  return {
    day, matches, selfChats, aces,
    aceLabels: highlights.map(row => String(row?.label ?? '')).filter(Boolean).slice(0, 3),
    herLines, appChats, gapDays,
    wins, losses,
    firsts: 0, streakDays, firstTimeChampions,
    ignoredAdvice: matches.reduce((total, row) => total + (row.adviceRevoked > 0 ? 1 : 0), 0),
  };
}

export async function availableDays({ stateDir, cutoffHours = DAY_CUTOFF_HOURS } = {}) {
  const days = new Set();
  for (const row of await readJsonl(join(stateDir, 'game-memory', 'match-history.jsonl'))) {
    if (Number.isFinite(Number(row?.at))) days.add(dayKey(Number(row.at), cutoffHours));
  }
  return [...days].sort();
}
