// Scheduling policy for automatic coach turns.
//
// Selection decides which advice is shown; scheduling decides whether a turn should be
// started at all, and in which lane. That distinction matters because a cloud turn
// measured 13-40 s in real matches while an ace or turret window only stays relevant for
// 15-25 s. Starting a full tool-using turn for a window that closes before the reply
// arrives is exactly how advice ends up revoked on arrival.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * How long a stage's advice stays worth showing, in milliseconds. Matches the overlay
 * validity windows so the scheduler and the display agree on when a window closes.
 */
export const STAGE_WINDOW = Object.freeze({
  ace: 20000, inhib: 25000, objective: 20000, turret: 15000,
  death: 45000, purchase: 45000, enemyChange: 45000, situation: 45000,
  augment: 60000, postAugment: 90000, ultimate: 90000, opening: 90000,
  loading: 90000, selection: 90000, ended: 120000,
});

/** Higher wins when two jobs compete for the same slot. */
export const STAGE_URGENCY = Object.freeze({
  ace: 5, augment: 5, inhib: 4, objective: 4, death: 4,
  turret: 3, purchase: 3, postAugment: 3, enemyChange: 2,
  ultimate: 2, opening: 2, loading: 2, selection: 2, situation: 1, ended: 1,
});

const DEFAULT_WINDOW = 45000;

/**
 * @param {object} options
 * @param {() => number} [options.now]           clock
 * @param {number} [options.deepLatencyMs]       assumed cost of a tool-using turn
 * @param {number} [options.fastLatencyMs]       assumed cost of a tools-off turn
 * @param {number} [options.deadlineShare]       fraction of the window a turn must fit in
 */
export function createCoachScheduler({ now = Date.now, deepLatencyMs = 35000, fastLatencyMs = 6000, deadlineShare = 0.8 } = {}) {
  const durations = new Map(); // stage -> EWMA of observed reply latency
  let pending = [];
  let seq = 0;

  const ewma = stage => durations.get(stage) ?? null;
  const windowOf = job => Number.isFinite(job.windowMs) ? job.windowMs : (STAGE_WINDOW[job.stage] ?? DEFAULT_WINDOW);
  const urgencyOf = job => Number.isFinite(job.urgency) ? job.urgency : (STAGE_URGENCY[job.stage] ?? 1);
  const remaining = (job, at) => windowOf(job) - (at - job.at);
  const expiresAt = job => job.at + windowOf(job);
  const expected = job => ewma(job.stage) ?? (job.deep === false ? fastLatencyMs : deepLatencyMs);

  /** Drop jobs whose window already closed; they can no longer be useful. */
  function prune(at) {
    const kept = [];
    for (const job of pending) if (remaining(job, at) > 0) kept.push(job); else job.dropped = 'expired';
    pending = kept;
  }

  /**
   * Lane choice: a deep turn only makes sense when it can plausibly finish while the
   * window is still useful. Otherwise fall back to the fast lane, and if even that is too
   * slow, decline instead of producing advice that is stale on arrival.
   */
  function laneFor(job, at) {
    const left = remaining(job, at);
    if (left <= 0) return { lane: 'drop', reason: 'expired' };
    if (expected(job) <= left * deadlineShare) return { lane: 'deep', reason: 'fits' };
    const fast = ewma(job.stage) !== null ? Math.min(ewma(job.stage), fastLatencyMs) : fastLatencyMs;
    if (fast <= left) return { lane: 'fast', reason: 'window_too_short_for_tools' };
    return { lane: 'drop', reason: 'cannot_finish_in_window' };
  }

  return {
    /** Queue a stage for analysis. Same coalesce key while one is pending replaces it. */
    submit({ stage, at = now(), windowMs, urgency, coalesceKey, deep } = {}) {
      if (!stage) throw Error('stage is required');
      const job = { id: ++seq, stage, at, windowMs, urgency, coalesceKey, deep };
      if (coalesceKey) {
        const same = pending.find(other => other.coalesceKey === coalesceKey);
        if (same) {
          // Keep the newer facts but do not spend a second turn on the same milestone.
          same.at = at;
          same.urgency = Math.max(urgencyOf(same), urgencyOf(job));
          return same;
        }
      }
      pending.push(job);
      return job;
    },

    /** Best job to run now, or null. Applies expiry, ordering and lane feasibility. */
    take() {
      const at = now();
      prune(at);
      if (!pending.length) return null;
      const ordered = [...pending].sort((a, b) =>
        urgencyOf(b) - urgencyOf(a) ||
        expiresAt(a) - expiresAt(b) ||
        a.id - b.id);
      const job = ordered[0];
      const { lane, reason } = laneFor(job, at);
      pending = pending.filter(other => other.id !== job.id);
      job.lane = lane;
      job.reason = reason;
      return { job, lane, reason };
    },

    /** Whether a newly submitted stage should interrupt the running turn. */
    shouldPreempt(runningStage, nextStage) {
      if (!runningStage) return false;
      return (STAGE_URGENCY[nextStage] ?? 1) > (STAGE_URGENCY[runningStage] ?? 1) + 1;
    },

    /** Feed measured reply latency back so lane choice tracks reality. */
    recordDuration(stage, ms) {
      if (!Number.isFinite(ms) || ms <= 0) return;
      const previous = durations.get(stage);
      const alpha = 0.4;
      durations.set(stage, previous === null || previous === undefined ? ms : clamp(alpha * ms + (1 - alpha) * previous, 500, 120000));
    },

    status() {
      const at = now();
      return {
        pending: pending.map(job => ({ stage: job.stage, urgency: urgencyOf(job), remainingMs: Math.max(0, remaining(job, at)) })),
        latency: Object.fromEntries([...durations].map(([stage, ms]) => [stage, Math.round(ms)])),
      };
    },
  };
}
