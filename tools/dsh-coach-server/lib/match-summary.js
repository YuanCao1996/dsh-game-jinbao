// Per-match summary store: the data foundation for progression ("养成").
//
// DSH's message-feedback service only records ratings when a UI collects them, and the
// overlay has no like/dislike yet. What we can do today without inventing UI is record
// one complete summary per finished match, from facts we already hold: result, duration,
// how much advice was produced, how much of it went stale, and how much the player asked.
//
// Both product lines write through game-memory, so this file is shared.

import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const list = value => Array.isArray(value) ? value : [];
const int = value => Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;

/** Build one finished-match summary from the overlay state. */
export function summarizeMatch(state = {}) {
  if (!state?.match || state.ended !== true) return null;
  const me = state.me ?? {};
  const broadcasts = list(state.broadcasts);
  const revoked = broadcasts.filter(b => b.revoked === true);
  return {
    match: state.match,
    game: state.game ?? null,
    champion: typeof me.champion === 'string' ? me.champion : null,
    seconds: int(state.gameSeconds),
    // 客户端只写 matchWin（布尔），从来没写过 result 字符串——148 局全是 null 就是这里漏接的。
    result: (() => {
      if (typeof state.result === 'string' && state.result) return state.result;
      if (typeof me.result === 'string' && me.result) return me.result;
      if (state.matchWin === true) return 'win';
      if (state.matchWin === false) return 'loss';
      return null;
    })(),
    kda: { k: int(me.k), d: int(me.d), a: int(me.a) },
    gold: int(me.gold),
    level: int(me.level),
    advice: { published: broadcasts.length, revoked: revoked.length, spokenPraise: broadcasts.filter(b => b.topic === 'praise').length },
    chat: { turns: list(state.chat).length },
    events: { count: list(state.events).length },
    augments: list(state.ownedAugments).length,
    at: Number.isFinite(Number(state.at)) ? Number(state.at) : null,
  };
}

/** Stable identity so a replayed match never double-counts. */
export function summaryKey(summary) {
  return `${summary?.game ?? '?'}:${summary?.match ?? '?'}`;
}

/**
 * Append-only store of finished-match summaries (`match-history.jsonl` under the memory
 * root). Re-recording the same match is a no-op, because the log is replayed on restart.
 */
export function createMatchSummaryStore(root) {
  const file = join(root, 'match-history.jsonl');
  let seen = null;
  const load = () => {
    if (seen) return seen;
    seen = new Set();
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { seen.add(summaryKey(JSON.parse(line))); } catch { /* ignore torn tail */ }
      }
    }
    return seen;
  };

  return {
    file,
    /** @returns the recorded summary, or null when it was skipped as duplicate/empty. */
    record(summary) {
      if (!summary?.match) return null;
      const known = load();
      const key = summaryKey(summary);
      if (known.has(key)) {
        // 第一次落盘时可能还没拿到胜负（阶段先变 EndOfGame，GameEnd 事件随后才到）。
        // 后来知道了就把那一行的 result 补上，否则 148 局全是 null。
        if (summary.result == null) return null;
        try {
          const text = readFileSync(file, 'utf8');
          const lines = text.split('\n');
          let changed = false;
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            let row; try { row = JSON.parse(lines[i]); } catch { continue; }
            if (summaryKey(row) !== key) continue;
            if (row.result == null) { lines[i] = JSON.stringify({ ...row, result: summary.result }); changed = true; }
            break;
          }
          if (!changed) return null;
          const temporary = file + '.tmp-' + process.pid;
          writeFileSync(temporary, lines.join('\n'), { mode: 0o600 });
          renameSync(temporary, file);
          return { ...summary, patched: true };
        } catch { return null; }
      }
      try {
        mkdirSync(root, { recursive: true });
        appendFileSync(file, JSON.stringify(summary) + '\n', { mode: 0o600 });
      } catch {
        return null;
      }
      known.add(key);
      return summary;
    },
    count() {
      return load().size;
    },
  };
}
