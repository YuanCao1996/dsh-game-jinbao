import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachScheduler, STAGE_WINDOW, STAGE_URGENCY } from '../coach-scheduler.mjs';

const clock = start => {
  let time = start;
  return { now: () => time, advance: ms => { time += ms; } };
};

test('a window too short for a tool-using turn falls back to the fast lane', () => {
  const { now } = clock(1000);
  const scheduler = createCoachScheduler({ now, deepLatencyMs: 25000, fastLatencyMs: 6000 });
  // An ace window is 20 s; a 25 s deep turn would land after it closes.
  scheduler.submit({ stage: 'ace' });
  const taken = scheduler.take();
  assert.equal(taken.lane, 'fast');
  assert.equal(taken.reason, 'window_too_short_for_tools');
});

test('a window with room keeps the deep lane', () => {
  const { now } = clock(1000);
  const scheduler = createCoachScheduler({ now, deepLatencyMs: 10000, fastLatencyMs: 4000 });
  scheduler.submit({ stage: 'situation' });
  assert.equal(scheduler.take().lane, 'deep');
});

test('measured latency replaces the assumption per stage', () => {
  const { now } = clock(1000);
  const scheduler = createCoachScheduler({ now, deepLatencyMs: 10000, fastLatencyMs: 4000 });
  // Real turns for this stage took ~38 s, so a 45 s window can no longer host a deep turn.
  for (let i = 0; i < 5; i++) scheduler.recordDuration('situation', 38000);
  scheduler.submit({ stage: 'situation' });
  assert.equal(scheduler.take().lane, 'fast');
});

test('a job whose window closed is dropped instead of wasting a turn', () => {
  const { now, advance } = clock(1000);
  const scheduler = createCoachScheduler({ now });
  scheduler.submit({ stage: 'turret' });
  advance(STAGE_WINDOW.turret + 1);
  assert.equal(scheduler.take(), null, 'an expired turret window must not be analysed');
});

test('when nothing can finish in time the turn is declined, not sent stale', () => {
  const { now, advance } = clock(1000);
  const scheduler = createCoachScheduler({ now, fastLatencyMs: 6000 });
  scheduler.submit({ stage: 'turret' });
  advance(STAGE_WINDOW.turret - 3000); // 3 s left, fast lane needs 6 s
  const taken = scheduler.take();
  assert.equal(taken.lane, 'drop');
  assert.equal(taken.reason, 'cannot_finish_in_window');
});

test('the same milestone is coalesced into one pending turn', () => {
  const { now } = clock(1000);
  const scheduler = createCoachScheduler({ now });
  const first = scheduler.submit({ stage: 'turret', coalesceKey: 'turret:7' });
  const second = scheduler.submit({ stage: 'turret', coalesceKey: 'turret:7' });
  assert.equal(first.id, second.id, 'repeat turret kills must not queue twice');
  assert.equal(scheduler.status().pending.length, 1);
});

test('urgent stages outrank calm ones, and sooner deadlines break ties', () => {
  const { now, advance } = clock(1000);
  const scheduler = createCoachScheduler({ now, deepLatencyMs: 1000 });
  scheduler.submit({ stage: 'situation', at: 1000 });
  scheduler.submit({ stage: 'ace', at: 1000 });
  assert.equal(scheduler.take().job.stage, 'ace', 'an ace window outranks a routine situation');
  advance(0);
  scheduler.submit({ stage: 'turret', at: 1000 });
  scheduler.submit({ stage: 'inhib', at: 1000 });
  assert.equal(scheduler.take().job.stage, 'inhib', 'a broken inhibitor outranks a tower');
});

test('a much more urgent stage is allowed to preempt the running turn', () => {
  const scheduler = createCoachScheduler({ now: () => 1000 });
  assert.equal(scheduler.shouldPreempt('situation', 'ace'), true);
  assert.equal(scheduler.shouldPreempt('ace', 'situation'), false);
  assert.equal(scheduler.shouldPreempt('turret', 'inhib'), false, 'one urgency step is not worth interrupting');
  assert.equal(scheduler.shouldPreempt(null, 'ace'), false);
});

test('the stage tables stay in step with the overlay windows', () => {
  assert.equal(STAGE_WINDOW.ace, 20000);
  assert.equal(STAGE_WINDOW.death, 45000);
  assert.equal(STAGE_URGENCY.ace > STAGE_URGENCY.situation, true);
});
