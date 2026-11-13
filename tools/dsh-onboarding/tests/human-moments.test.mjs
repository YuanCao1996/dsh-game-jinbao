import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleHumanMoments, resetHumanMoments, MOMENT_ROLES, DEATH_MIN_GAP_MS, DEATH_MAX_PER_MATCH } from '../human-moments.mjs';

// 昨晚实测：23/22/29 分钟的对局各只有 4/5/4 条播报，全是出装建议；
// 38 次阵亡零反馈，最长沉默 16.6 分钟。这一层补的就是"每局必有几句人话"。

const base = (patch = {}) => ({
  match: 'm#1',
  gameSeconds: 0,
  me: { dead: false },
  broadcasts: [],
  ...patch,
});

const lastText = state => state.broadcasts.at(-1)?.text ?? '';

test('四种人设都有开局/阵亡/结束/沉默台词', () => {
  for (const role of MOMENT_ROLES) {
    for (const cue of ['opening', 'death', 'endWin', 'endLoss', 'idle']) {
      const state = base();
      let ok = false;
      const now = Date.now();
      if (cue === 'opening') { state.gameSeconds = 10; ok = settleHumanMoments(state, now, { role, clock: 10 }); }
      if (cue === 'death') { state.me.dead = true; state.broadcasts = [{ at: now - 60_000, text: '上一句' }]; ok = settleHumanMoments(state, now, { role, clock: 20 }); }
      if (cue === 'endWin') { ok = settleHumanMoments(state, now, { role, clock: 1200, ended: true, win: true }); }
      if (cue === 'endLoss') { ok = settleHumanMoments(state, now, { role, clock: 1200, ended: true, win: false }); }
      if (cue === 'idle') {
        state.gameSeconds = 600;
        state.broadcasts = [{ at: now - 9 * 60_000, text: '很久以前' }];
        state.humanMoments = { match: 'm#1', emitted: { opening: true }, deaths: 0, lastDeathAt: 0, lastAt: now - 9 * 60_000 };
        ok = settleHumanMoments(state, now, { role, clock: 600 });
      }
      assert.ok(ok, `${role} 缺少 ${cue} 台词`);
      assert.ok(lastText(state).length <= 30, `${role}/${cue} 台词过长: ${lastText(state)}`);
    }
  }
});

test('开局问候：进对局 3 秒后才说，且一局只有一次', () => {
  const state = base({ gameSeconds: 1 });
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 1 }), false, '加载中不问候');
  state.gameSeconds = 5;
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 5 }), true);
  assert.equal(settleHumanMoments(state, Date.now() + 1000, { role: 'jinbao', clock: 6 }), false, '只问一次');
});

test('阵亡反应有次数上限与间隔限制', () => {
  const state = base();
  const now = Date.now();
  state.gameSeconds = 60;
  state.humanMoments = { match: 'm#1', emitted: { opening: true }, deaths: 0, lastDeathAt: 0, lastAt: now - 60_000 };
  state.broadcasts = [{ at: now - 60_000, text: '开局了' }];

  let count = 0;
  for (let i = 0; i < 6; i += 1) {
    state.me.dead = true;
    const at = now + i * (DEATH_MIN_GAP_MS + 1000);
    if (settleHumanMoments(state, at, { role: 'jinbao', clock: 60 + i })) count += 1;
    state.me.dead = false;              // 复活
    settleHumanMoments(state, at + 500, { role: 'jinbao', clock: 61 + i });
  }
  assert.equal(count, DEATH_MAX_PER_MATCH, '一局最多反应 3 次阵亡，实际 ' + count);
});

test('最近有战术播报时不插话', () => {
  const state = base({ gameSeconds: 60 });
  state.broadcasts = [{ at: Date.now() - 3000, text: '下一件先做负极斗篷' }];
  state.me.dead = true;
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 60 }), false);
});

test('结束语按胜负选措辞，且优先于阵亡与沉默', () => {
  const winState = base({ gameSeconds: 1200, me: { dead: true } });
  assert.equal(settleHumanMoments(winState, Date.now(), { role: 'jinbao', clock: 1200, ended: true, win: true }), true);
  const winText = lastText(winState);
  assert.ok(/赢|拿下|稳/.test(winText), '胜利结束语措辞不对: ' + winText);

  const lossState = base({ gameSeconds: 1200 });
  assert.equal(settleHumanMoments(lossState, Date.now(), { role: 'jinbao', clock: 1200, ended: true, win: false }), true);
  assert.ok(/输|没拿下|没赢/.test(lastText(lossState)), '失败结束语措辞不对: ' + lastText(lossState));
});

test('长时间沉默：8 分钟没说话才补一句，且只补一次', () => {
  const now = Date.now();
  const state = base({ gameSeconds: 900 });
  state.humanMoments = { match: 'm#1', emitted: { opening: true }, deaths: 0, lastDeathAt: 0, lastAt: now - 5 * 60_000 };
  state.broadcasts = [{ at: now - 5 * 60_000, text: '五分钟前' }];
  assert.equal(settleHumanMoments(state, now, { role: 'jinbao', clock: 900 }), false, '才 5 分钟不该插话');

  state.humanMoments.lastAt = now - 9 * 60_000;
  assert.equal(settleHumanMoments(state, now, { role: 'jinbao', clock: 900 }), true);
  state.humanMoments.lastAt = now - 9 * 60_000;
  assert.equal(settleHumanMoments(state, now + 1000, { role: 'jinbao', clock: 901 }), false, '一局只补一次');
});

test('换对局后记忆重置', () => {
  const state = base({ match: 'm#1', gameSeconds: 30 });
  settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 10 });
  state.match = 'm#2';
  state.gameSeconds = 5;
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 5 }), true, '新对局应重新问好');
  resetHumanMoments(state);
  assert.equal(state.humanMoments.match, 'm#2');
  assert.deepEqual(state.humanMoments.emitted, {});
});
