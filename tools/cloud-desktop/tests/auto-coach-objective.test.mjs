import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudCoach } from '../auto-coach.mjs';

const base = () => ({
  game: 'lol', match: 'one', phase: 'InProgress', gameSeconds: 600,
  me: { champion: '安妮', level: 11, items: [] }, allies: [], enemies: [],
  offers: [], ownedAugments: [], revealedAugments: [], events: [],
});

function harness(getCurrent) {
  const state = { time: 10000, calls: 0, entries: [], questions: [] };
  const coach = createCloudCoach({
    view: () => ({ game: 'lol', match: 'one', updatedAt: state.time }),
    getContext: async () => ({ current: getCurrent() }),
    now: () => state.time,
    agent: {
      ask: async request => {
        state.calls++;
        state.questions.push(request.question);
        return '对面刚团灭，20 秒真空：推中塔，别回城。';
      },
    },
    publish: async entry => state.entries.push(entry),
  });
  return { state, coach };
}

test('a fresh objective wakes the coach with its own stage and map dimension', async () => {
  let current = base();
  const { state, coach } = harness(() => current);

  // The first poll legitimately opens an opening/ultimate turn; that is not what we test.
  await coach.tick();
  const baseline = state.calls;

  current = { ...current, events: [{ key: 'Ace:1', kind: 'Ace', time: '10:00', text: '团灭' }] };
  await coach.tick();
  assert.equal(state.calls, baseline + 1, 'a fresh ace must reach the model');
  const ace = state.entries.filter(entry => entry.key === 'ace');
  assert.equal(ace.length, 1);
  assert.equal(ace[0].dimension, 'map', 'objectives belong to the map dimension');

  // The same recorded objective must not keep firing on every poll.
  state.time += 5000;
  await coach.tick();
  assert.equal(state.entries.filter(entry => entry.key === 'ace').length, 1, 'consumed objective must not retrigger');
  coach.close();
});

test('an objective turn asks for multi-step reasoning with the tools, not a single shot', async () => {
  let current = base();
  const { state, coach } = harness(() => current);
  await coach.tick();
  current = { ...current, events: [{ key: 'Ace:9', kind: 'Ace', time: '12:00', text: '团灭' }] };
  await coach.tick();

  const question = state.questions.at(-1) ?? '';
  assert.match(question, /工作方式（多步/, 'the turn must ask for multi-step work');
  assert.match(question, /query_match_events|game_log_query/, 'events lookup must be offered');
  assert.match(question, /site_query|web_search/, 'retrieval must be offered');
  assert.match(question, /inspect_latest_screen/, 'screen reading must be offered');
  assert.match(question, /只输出播报正文/, 'the workflow must forbid narrating the tool use');
  coach.close();
});

test('a turret is mapped to the map dimension as well', async () => {
  let current = base();
  const { state, coach } = harness(() => current);
  await coach.tick();
  current = { ...current, events: [{ key: 'TurretKilled:7', kind: 'TurretKilled', time: '07:29', text: '防御塔被摧毁' }] };
  await coach.tick();
  assert.equal(state.entries.at(-1)?.key, 'turret');
  assert.equal(state.entries.at(-1)?.dimension, 'map');
  coach.close();
});

test('an auto-picked augment still opens a post-augment turn', async () => {
  let current = base();
  const { state, coach } = harness(() => current);
  await coach.tick();
  const before = state.entries.length;

  // The countdown defaulted to this augment: the player did not click it, but it is what
  // they now have to play around, so advice must account for it.
  current = { ...current, revealedAugments: ['坦克引擎'] };
  await coach.tick();
  assert.equal(state.entries.length, before + 1, 'auto-picked augment must reach the model');
  const entry = state.entries.at(-1);
  assert.equal(entry.key, 'postAugment');
  assert.equal(entry.dimension, 'augment');
  coach.close();
});

// 实测一局 154 个 tick 只有 21 个跑到判定，跨 ±2 的配合窗口大多撞在 busy/背压上被丢掉。
// 现在窗口在闸门之前就被记下来，等下一个能跑的 tick 补发。
test('a fight window swallowed by a busy tick is still delivered later', async () => {
  const state = { time: 10_000, entries: [], alliesAlive: 5, enemiesAlive: 5, agentBusy: false };
  const coach = createCloudCoach({
    view: () => ({
      game: 'lol', match: 'one', phase: 'InProgress', updatedAt: state.time,
      selfChampion: '安妮', dead: false, alliesAlive: state.alliesAlive, enemiesAlive: state.enemiesAlive,
    }),
    getContext: async () => ({
      current: {
        ...base(),
        me: { champion: '安妮', level: 11, items: [], dead: false },
        allies: [{ champion: '盖伦', dead: false }],
        enemies: [{ champion: '锐雯', dead: state.enemiesAlive < 5 }],
      },
    }),
    now: () => state.time,
    agent: { busy: () => state.agentBusy, ask: async () => '跟泰坦一起上，等他控制命中再进。' },
    publish: async entry => state.entries.push(entry),
  });

  await coach.tick(); // 5v5 建立基线
  state.time += 3000;
  state.agentBusy = true;
  state.alliesAlive = 5; state.enemiesAlive = 3; // 窗口打开，但这一轮 agent 忙 → 被吞掉
  await coach.tick();
  assert.equal(state.entries.filter(entry => entry.key === 'coordination').length, 0, '忙的时候不该硬抢模型');

  state.time += 3000;
  state.agentBusy = false;
  await coach.tick(); // 补发
  const coordination = state.entries.filter(entry => entry.key === 'coordination');
  assert.equal(coordination.length, 1, '被吞掉的窗口必须补发');
  assert.equal(coordination[0].dimension, 'now');
  assert.equal(coordination[0].priority, 2);

  // 同一个窗口不能反复补发。
  state.time += 3000;
  await coach.tick();
  assert.equal(state.entries.filter(entry => entry.key === 'coordination').length, 1);
  coach.close();
});
test('a side-man swing opens a coordination turn that names real champions', async () => {
  let current = {
    ...base(),
    me: { champion: '安妮', level: 11, items: [], dead: false },
    allies: [{ champion: '盖伦', dead: false }, { champion: '瑞兹', dead: false }],
    enemies: [{ champion: '锐雯', dead: false }, { champion: '亚索', dead: false }],
  };
  const { state, coach } = harness(() => current);
  await coach.tick();
  const baseline = state.calls;

  // 对面两人阵亡：人数差从 +1 拉到 +3，这是一次真实的开团/拿目标窗口。
  current = { ...current, enemies: [{ champion: '锐雯', dead: true }, { champion: '亚索', dead: true }] };
  await coach.tick();
  assert.equal(state.calls, baseline + 1, 'a side-man swing must reach the model');

  const entry = state.entries.at(-1);
  assert.equal(entry.key, 'coordination');
  assert.equal(entry.dimension, 'now');
  assert.equal(entry.priority, 2, '配合窗口与团战同级');
  const question = state.questions.at(-1) ?? '';
  assert.match(question, /【本轮配合窗口】/, '存活名单必须进 prompt');
  assert.match(question, /盖伦/, '点名真实队友，而不是“队友”');
  assert.match(question, /跟谁一起上/);
  coach.close();
});
