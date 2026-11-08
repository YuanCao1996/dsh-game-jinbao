// Companion state: the "relationship" layer that survives between matches.
//
// The three memory layers we already had are match-scoped facts, per-game preferences and
// per-match summaries. None of them can answer "have we played a lot together?" or "did I
// just lose twice in a row?" — which is exactly what makes a coach feel like a person
// instead of a function. This file keeps that small, fact-driven state.
//
// Rules here are deliberately cheap: no extra model call, one short line at most, and the
// line is produced from recorded facts (matches, results, time of day), never invented.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DAY = 86_400_000;
const LATE_NIGHT = [23, 6]; // [start, end) in local hours
const COMFORT_AFTER_LOSSES = 2;
const RETURN_AFTER_MS = 3 * DAY;

export function companionPath(stateDir) {
  return join(stateDir, 'companion-state.json');
}

export function emptyCompanion() {
  return {
    version: 1,
    matches: 0,
    wins: 0,
    losses: 0,
    lossRun: 0,
    intimacy: 0,
    lastSeenAt: null,
    lastPlayedAt: null,
    greetedFor: null,
    comfortedLossRun: 0,
  };
}

const isLateNight = (at) => {
  const hour = new Date(at).getHours();
  return hour >= LATE_NIGHT[0] || hour < LATE_NIGHT[1];
};

/**
 * Decide the one opening line for this match, if any.
 * Priority is fixed so the most human-relevant reason wins: coming back after a long
 * absence, then a losing streak, then the very first game, then a late-night note.
 */
export function openingLine(state, { game, match, at = Date.now() } = {}) {
  if (!state || state.greetedFor === match) return null;
  const nights = isLateNight(at);

  if (state.lastSeenAt && at - state.lastSeenAt >= RETURN_AFTER_MS) {
    const days = Math.max(1, Math.round((at - state.lastSeenAt) / DAY));
    return `${days} 天没见了，先陪你打一局。`;
  }
  if (state.lossRun >= COMFORT_AFTER_LOSSES && state.comfortedLossRun !== state.lossRun) {
    return `连着输了 ${state.lossRun} 局，这局先稳一手，别急。`;
  }
  if (!state.matches) {
    return nights ? '第一次一起打，夜深了，我只说关键的那句。' : '第一次一起打，这局我先看阵容。';
  }
  if (nights) return '夜深了，这局我只说关键的一句。';
  return null;
}

/**
 * @param {object} options
 * @param {string} options.stateDir state directory (companion-state.json lives here)
 * @param {() => number} [options.now]
 */
export function createCompanion({ stateDir, now = Date.now } = {}) {
  const file = companionPath(stateDir);
  let cache = null;

  const read = () => {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      cache = { ...emptyCompanion(), ...parsed };
    } catch {
      cache = emptyCompanion();
    }
    return cache;
  };

  const write = (next) => {
    cache = next;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      // Progressive features must never break the coach.
    }
    return next;
  };

  return {
    file,
    state: read,

    /**
     * Called when a match starts. Returns the opening line (or null) and remembers that
     * this match was greeted so a reload does not repeat it.
     */
    touch({ game, match } = {}) {
      const at = now();
      const current = read();
      const line = openingLine(current, { game, match, at });
      const next = { ...current, lastSeenAt: at, greetedFor: line ? match : current.greetedFor };
      if (line && current.lossRun >= COMFORT_AFTER_LOSSES) next.comfortedLossRun = current.lossRun;
      write(next);
      return line;
    },

    /** Called once when a match ends. Intimacy moves on facts, never on a timer. */
    recordResult({ win, match, at = now() } = {}) {
      const current = read();
      // Log replay re-reads finished matches; count each one exactly once.
      if (match && current.lastResultMatch === match) return current;
      const next = {
        ...current,
        matches: current.matches + 1,
        wins: current.wins + (win === true ? 1 : 0),
        losses: current.losses + (win === false ? 1 : 0),
        lossRun: win === false ? current.lossRun + 1 : 0,
        lastResultMatch: match ?? current.lastResultMatch ?? null,
        intimacy: current.intimacy + 1,
        lastSeenAt: at,
        lastPlayedAt: at,
      };
      // A fresh streak deserves a fresh comfort line.
      if (win !== false) next.comfortedLossRun = 0;
      return write(next);
    },

    /** Read-only summary for diagnostics and future progression UI. */
    snapshot() {
      const s = read();
      return {
        matches: s.matches, wins: s.wins, losses: s.losses,
        lossRun: s.lossRun, intimacy: s.intimacy,
        lastPlayedAt: s.lastPlayedAt,
      };
    },
  };
}

export { isLateNight, COMFORT_AFTER_LOSSES, RETURN_AFTER_MS };
