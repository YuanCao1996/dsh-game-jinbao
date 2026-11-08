// Broadcast contract for goal mode.
//
// The event-driven path answers one request and returns text through `coach_reply`. Goal
// mode has no pending request: the agent decides per round whether the player should hear
// anything. Saying nothing is a valid outcome, so an empty payload produces no entry at
// all rather than an empty bubble on the battle page.

/** Characters allowed in one goal-mode broadcast, and how long it stays on the page. */
export const GOAL_BROADCAST = Object.freeze({ maxChars: 240, ttlMs: 90000 });

/**
 * Build the broadcast line for one goal-mode reply.
 *
 * @returns the entry to append, or null when the agent chose to stay silent.
 */
export function goalBroadcastEntry({ game, text, dimension = 'now', now = Date.now } = {}) {
  const body = String(text ?? '').replace(/[ \t]+\n/g, '\n').trim();
  if (!body) return null;
  const at = now();
  return {
    at: new Date(at).toISOString(),
    source: 'goal',
    game,
    kind: 'cloud-advice',
    key: 'situation',
    dimension,
    broadcast: body.slice(0, GOAL_BROADCAST.maxChars),
    expiresAt: at + GOAL_BROADCAST.ttlMs,
  };
}
