import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoalCoach, resolveCoachMode, DEFAULT_GOAL_OBJECTIVE } from '../lib/goal-coach.js';

function fakeGoals() {
  const calls = { create: [], complete: [] };
  let current = null;
  return {
    calls,
    create(agent, request) {
      calls.create.push({ agent, request });
      current = { id: 'goal-1', revision: 1, objective: request.objective, phase: 'active', maxGoalRounds: request.maxGoalRounds };
      return current;
    },
    complete(agent, ref) {
      calls.complete.push({ agent, ref });
      return { ...current, phase: 'complete' };
    },
  };
}

test('goal mode is opt-in and off by default', () => {
  assert.equal(resolveCoachMode({}), 'event');
  assert.equal(resolveCoachMode({ goalCoach: { enabled: false } }), 'event');
  assert.equal(resolveCoachMode({ goalCoach: { enabled: true } }), 'goal');
});

test('the standing objective carries the behaviour rules, not just a title', () => {
  assert.match(DEFAULT_GOAL_OBJECTIVE, /陪玩家打好这一局/);
  assert.match(DEFAULT_GOAL_OBJECTIVE, /静默/, 'silence must be part of the goal');
  assert.match(DEFAULT_GOAL_OBJECTIVE, /工具/, 'facts must come from tools each round');
  assert.match(DEFAULT_GOAL_OBJECTIVE, /不编造/);
});

test('without a goal service the mode reports unsupported instead of throwing', async () => {
  const coach = createGoalCoach({ getGoals: () => undefined, createSession: async () => ({ agent: {} }) });
  assert.equal(coach.supported, false);
  const result = await coach.begin({ game: 'lol', match: 'm1' });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'goals_unavailable');
  assert.equal(coach.active, false);
});

test('arming creates exactly one goal per match', async () => {
  const goals = fakeGoals();
  let sessions = 0;
  const coach = createGoalCoach({
    getGoals: () => goals,
    createSession: async () => { sessions++; return { agent: { id: 'session' } }; },
  });
  const first = await coach.begin({ game: 'lol', match: 'm1', maxGoalRounds: 25 });
  assert.equal(first.status, 'active');
  assert.equal(first.goalId, 'goal-1');
  assert.equal(goals.calls.create.length, 1);
  assert.equal(goals.calls.create[0].request.maxGoalRounds, 25);
  assert.match(goals.calls.create[0].request.objective, /陪玩家打好这一局/);

  const again = await coach.begin({ game: 'lol', match: 'm1' });
  assert.equal(again.status, 'already-active');
  assert.equal(goals.calls.create.length, 1, 'a second arm must not start a parallel goal');
  assert.equal(sessions, 1);
});

test('finishing completes the armed goal and clears local state', async () => {
  const goals = fakeGoals();
  const coach = createGoalCoach({ getGoals: () => goals, createSession: async () => ({ agent: { id: 'session' } }), now: () => 5000 });
  await coach.begin({ game: 'lol', match: 'm1' });
  const report = await coach.finish('match-ended');
  assert.equal(report.status, 'completed');
  assert.equal(report.reason, 'match-ended');
  assert.deepEqual(goals.calls.complete[0].ref, { id: 'goal-1', revision: 1 });
  assert.equal(coach.active, false);
  assert.equal((await coach.finish()).status, 'idle', 'finishing twice is harmless');
});

test('switching matches retires the previous goal before arming the next', async () => {
  const goals = fakeGoals();
  const coach = createGoalCoach({ getGoals: () => goals, createSession: async () => ({ agent: {} }) });
  await coach.begin({ game: 'lol', match: 'm1' });
  await coach.begin({ game: 'lol', match: 'm2' });
  assert.equal(goals.calls.complete.length, 1, 'the first match goal is completed');
  assert.equal(goals.calls.create.length, 2);
  assert.equal(coach.status().mode, 'goal-active');
});

test('a broken goal service is contained, never fatal to the coach plugin', async () => {
  const coach = createGoalCoach({
    getGoals: () => ({ create() { throw new Error('goal service down'); } }),
    createSession: async () => ({ agent: {} }),
  });
  await assert.rejects(() => coach.begin({ game: 'lol', match: 'm1' }), /goal service down/);
});


function gatedGoal({ gapMs, clock }) {
  const calls = [];
  const state = { rounds: 0, phase: 'active', revision: 1 };
  const goals = {
    create: () => ({ id: 'g1', revision: 1, phase: 'active', maxGoalRounds: 40 }),
    get: () => ({ goal: { id: 'g1', revision: state.revision, phase: state.phase }, roundsStarted: state.rounds }),
    pause: () => { calls.push('pause'); state.phase = 'paused'; state.revision++; },
    resume: () => { calls.push('resume'); state.phase = 'active'; state.revision++; },
    complete: () => {},
  };
  const coach = createGoalCoach({ getGoals: () => goals, createSession: async () => ({ agent: {} }), now: () => clock.now(), roundGapMs: gapMs });
  return { coach, calls, state };
}

test('with no gap configured the gate leaves the driver alone', async () => {
  const clock = { t: 1000, now() { return this.t; } };
  const { coach, calls } = gatedGoal({ gapMs: 0, clock });
  await coach.begin({ game: 'lol', match: 'm1' });
  const result = coach.gate();
  assert.equal(result.status, 'ungated');
  assert.deepEqual(calls, [], 'no pause when pacing is disabled');
});

test('a configured gap pauses after a round and resumes when the gap elapses', async () => {
  const clock = { t: 1000, now() { return this.t; } };
  const { coach, calls, state } = gatedGoal({ gapMs: 30000, clock });
  await coach.begin({ game: 'lol', match: 'm1' });

  // First round finished: the driver would immediately queue another one.
  state.rounds = 1;
  assert.equal(coach.gate().status, 'paused');
  assert.deepEqual(calls, ['pause']);

  // Still inside the gap: stay paused instead of resuming early.
  clock.t += 5000;
  assert.equal(coach.gate().status, 'ok');
  assert.deepEqual(calls, ['pause']);

  // Gap elapsed: exactly one resume.
  clock.t += 30000;
  assert.equal(coach.gate().status, 'resumed');
  assert.deepEqual(calls, ['pause', 'resume']);
  coach.close?.();
});

test('the gate never throws at the host when the goal service misbehaves', async () => {
  const coach = createGoalCoach({
    getGoals: () => ({ create: () => ({ id: 'g', revision: 1, phase: 'active' }), get: () => { throw new Error('read failed'); }, complete: () => {} }),
    createSession: async () => ({ agent: {} }),
    roundGapMs: 15000,
  });
  await coach.begin({ game: 'lol', match: 'm1' });
  assert.equal(coach.gate().status, 'unreadable');
});
