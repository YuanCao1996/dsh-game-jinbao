import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion, emptyCompanion, openingLine, isLateNight } from '../lib/companion.mjs';
import { initialOverlayState, overlayView } from '../../dsh-onboarding/overlay-state.mjs';

const DAY = 86_400_000;
const at = (iso) => new Date(iso).getTime();

test('late night is the 23:00-06:00 window', () => {
  assert.equal(isLateNight(at('2026-11-04T23:30:00')), true);
  assert.equal(isLateNight(at('2026-11-04T02:00:00')), true);
  assert.equal(isLateNight(at('2026-11-04T06:00:00')), false);
  assert.equal(isLateNight(at('2026-11-04T14:00:00')), false);
});

test('the opening line prefers returning after an absence over everything else', () => {
  const state = { ...emptyCompanion(), matches: 9, lossRun: 3, lastSeenAt: at('2026-10-30T20:00:00') };
  const line = openingLine(state, { match: 'm1', at: at('2026-11-04T14:00:00') });
  assert.match(line, /天没见了/);
});

test('a losing streak gets one comfort line, not one per match', () => {
  const state = { ...emptyCompanion(), matches: 5, lossRun: 2, lastSeenAt: at('2026-11-04T13:00:00') };
  const first = openingLine(state, { match: 'm1', at: at('2026-11-04T14:00:00') });
  assert.match(first, /连着输了 2 局/);
  // After being comforted for this streak, the next match stays quiet.
  const comforted = { ...state, comfortedLossRun: 2 };
  assert.equal(openingLine(comforted, { match: 'm2', at: at('2026-11-04T14:30:00') }), null);
});

test('the very first match is greeted once, with a night variant', () => {
  const fresh = emptyCompanion();
  assert.match(openingLine(fresh, { match: 'm1', at: at('2026-11-04T14:00:00') }), /第一次一起打/);
  assert.match(openingLine(fresh, { match: 'm1', at: at('2026-11-04T23:30:00') }), /夜深了/);
});

test('a quiet afternoon with history produces no line at all', () => {
  const state = { ...emptyCompanion(), matches: 12, lossRun: 0, lastSeenAt: at('2026-11-04T10:00:00') };
  assert.equal(openingLine(state, { match: 'm1', at: at('2026-11-04T14:00:00') }), null);
});

test('late night still speaks when there is history but nothing else to say', () => {
  const state = { ...emptyCompanion(), matches: 12, lossRun: 0, lastSeenAt: at('2026-11-04T20:00:00') };
  assert.match(openingLine(state, { match: 'm1', at: at('2026-11-04T23:30:00') }), /夜深了/);
});

test('touch returns the line once per match and persists state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-companion-'));
  let clock = at('2026-11-04T14:00:00');
  const companion = createCompanion({ stateDir: dir, now: () => clock });
  const first = companion.touch({ game: 'lol', match: 'm1' });
  assert.match(first, /第一次一起打/);
  clock += 1000;
  assert.equal(companion.touch({ game: 'lol', match: 'm1' }), null, 'a reload must not repeat the greeting');
  assert.match(companion.touch({ game: 'lol', match: 'm2' }), /夜深了|第一次|天没见|连着输/, 'a new match may greet again');

  const reopened = createCompanion({ stateDir: dir, now: () => clock });
  assert.equal(reopened.state().lastSeenAt, clock);
});

test('results move intimacy and streaks on facts, and each match counts once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-companion-'));
  const companion = createCompanion({ stateDir: dir, now: () => at('2026-11-04T14:00:00') });
  companion.recordResult({ win: false, match: 'm1' });
  companion.recordResult({ win: false, match: 'm2' });
  let snapshot = companion.snapshot();
  assert.equal(snapshot.matches, 2);
  assert.equal(snapshot.losses, 2);
  assert.equal(snapshot.lossRun, 2);
  assert.equal(snapshot.intimacy, 2);

  companion.recordResult({ win: false, match: 'm2' });
  assert.equal(companion.snapshot().matches, 2, 'replaying a finished match must not double count');

  companion.recordResult({ win: true, match: 'm3' });
  snapshot = companion.snapshot();
  assert.equal(snapshot.wins, 1);
  assert.equal(snapshot.lossRun, 0, 'a win clears the losing streak');
  assert.equal(snapshot.intimacy, 3);
});

test('the battle page shows the opening line only during the first two minutes', () => {
  const now = Date.now();
  const state = { ...initialOverlayState(), game: 'lol', match: 'm1', matchStartedAt: now - 10_000, companionLine: '三天没见了，先陪你打一局。' };
  assert.match(overlayView(state).advice, /三天没见了/);

  const stale = { ...state, matchStartedAt: now - 200_000 };
  assert.doesNotMatch(overlayView(stale).advice, /三天没见了/);
});
