import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureSchedule} from '../capture-schedule.mjs';

// Every full-frame OCR costs about a second in a real match, and the capture loop used to
// run one on every cycle whenever no augment panel was on screen — which is almost always.
// The schedule now gates the full pass regardless of panel state, so these pin the cadence.

test('the full frame runs at most once per interval and titles fill the gap', () => {
  let clock = 10_000;
  const schedule = createCaptureSchedule({now: () => clock});

  assert.equal(schedule.choose(), 'full', 'a fresh schedule calibrates immediately');
  assert.equal(schedule.choose(), 'titles');
  clock += 1999;
  assert.equal(schedule.choose(), 'titles', 'just under the interval stays cheap');
  clock += 1;
  assert.equal(schedule.choose(), 'full', 'the interval elapsed');
  assert.equal(schedule.choose(), 'titles');
});

test('a long gap without captures still only spends one full frame', () => {
  let clock = 0;
  const schedule = createCaptureSchedule({now: () => clock});
  assert.equal(schedule.choose(), 'full');
  clock += 60_000;
  assert.equal(schedule.choose(), 'full');
  assert.equal(schedule.choose(), 'titles', 'catching up must not queue several full frames');
});

test('reset lets a new match calibrate on its first capture', () => {
  let clock = 0;
  const schedule = createCaptureSchedule({now: () => clock});
  schedule.choose();
  assert.equal(schedule.choose(), 'titles');
  schedule.reset();
  assert.equal(schedule.choose(), 'full');
});

test('the interval is configurable for tests and slower machines', () => {
  let clock = 0;
  const schedule = createCaptureSchedule({now: () => clock, fullIntervalMs: 5_000});
  assert.equal(schedule.choose(), 'full');
  clock += 4_999;
  assert.equal(schedule.choose(), 'titles');
  clock += 1;
  assert.equal(schedule.choose(), 'full');
});

test('death boost makes the cheap title pass run continuously', () => {
  // ARAM 的三选一跟在阵亡之后：重点窗口内不再等整屏间隔，直接跑标题帧。
  let clock = 0;
  const schedule = createCaptureSchedule({ now: () => clock, fullIntervalMs: 4000 });
  assert.equal(schedule.choose(), 'full');
  assert.equal(schedule.choose(), 'titles');
  clock += 4000;
  assert.equal(schedule.choose(), 'full');
  schedule.boost(25000);
  clock += 10;
  assert.equal(schedule.hot(), true);
  // 窗口内即使到了整屏时间点也只跑标题
  for (const step of [500, 2000, 4000, 8000]) {
    clock += step;
    assert.equal(schedule.choose(), 'titles', 'within boost window');
  }
  clock += 25000;
  assert.equal(schedule.hot(), false);
  assert.equal(schedule.choose(), 'full', 'window expires and the normal cadence resumes');
});
