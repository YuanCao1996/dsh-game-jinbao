import test from 'node:test';
import assert from 'node:assert/strict';
import { goalBroadcastEntry, GOAL_BROADCAST } from '../lib/goal-broadcast.js';

test('a goal broadcast carries the same contract the overlay already reads', () => {
  const entry = goalBroadcastEntry({ game: 'lol', text: '对面团灭，20 秒真空：推中塔', now: () => 1000 });
  assert.equal(entry.source, 'goal');
  assert.equal(entry.kind, 'cloud-advice');
  assert.equal(entry.key, 'situation');
  assert.equal(entry.dimension, 'now');
  assert.equal(entry.game, 'lol');
  assert.match(entry.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(entry.expiresAt, 1000 + GOAL_BROADCAST.ttlMs);
});

test('saying nothing produces no entry at all', () => {
  // Silence is a first-class outcome in goal mode, not an empty bubble on the page.
  assert.equal(goalBroadcastEntry({ game: 'lol', text: '' }), null);
  assert.equal(goalBroadcastEntry({ game: 'lol', text: '   \n\t ' }), null);
  assert.equal(goalBroadcastEntry({ game: 'lol', text: null }), null);
});

test('long text is bounded and trailing spaces are cleaned', () => {
  const entry = goalBroadcastEntry({ game: 'lol', text: '一'.repeat(400) });
  assert.equal(entry.broadcast.length, GOAL_BROADCAST.maxChars);

  const cleaned = goalBroadcastEntry({ game: 'lol', text: '先清线   \n再回城  ' });
  assert.equal(cleaned.broadcast, '先清线\n再回城');
});

test('the dimension can be overridden for objective turns', () => {
  assert.equal(goalBroadcastEntry({ game: 'lol', text: '一塔掉了：转中', dimension: 'map' }).dimension, 'map');
});
