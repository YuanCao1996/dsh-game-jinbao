import { test } from 'node:test';
import assert from 'node:assert/strict';
import { augmentConfirmation, augmentConfirmationId } from '../augment-confirmation.mjs';

// 2026-11-12 狂厄蔷薇那局：4 次三选一全部没判定成功，且没有任何确认弹窗，
// 玩家什么都没看到，回忆里 augments 为空。修复后 collector 会在判定不出来时
// 补发 augment_offer_closed(reason:'undecided')，这里确认「关闭但未确认」的轮次
// 确实能生成确认提示（3 秒后，按英雄适配排名排列）。
function baseState(round) {
  return {
    game: 'lol',
    match: 'lol-live-test.jsonl#1',
    matchStartedAt: 1_700_000_000_000,
    at: Date.now(),
    ended: false,
    me: { champion: '狂厄蔷薇' },
    augmentRounds: [round],
  };
}

test('判定失败的轮次会弹出确认提示，而不是静默丢弃', () => {
  const closedAt = Date.now() - 5000;
  const round = {
    id: 1,
    options: ['双刀流', '秘术冲拳', '大法师'],
    currentOptions: ['双刀流', '秘术冲拳', '大法师'],
    confirmed: [],
    closed: true,
    closedAt,
    dismissed: false,
  };
  const prompt = augmentConfirmation(baseState(round), []);
  assert.ok(prompt, '关闭但未确认的轮次必须生成确认提示');
  assert.equal(prompt.title, '刚才选了哪个海克斯？');
  assert.ok(prompt.options.length >= 2);
  assert.ok(prompt.options.some(o => o.name === '秘术冲拳'));
  assert.equal(prompt.round, 1);
});

test('已确认的轮次不再打扰玩家', () => {
  const round = {
    id: 2,
    options: ['双刀流', '大法师'],
    currentOptions: ['双刀流', '大法师'],
    confirmed: ['大法师'],
    closed: true,
    closedAt: Date.now() - 5000,
    dismissed: false,
  };
  assert.equal(augmentConfirmation(baseState(round), []), null);
});

test('轮次刚关闭的前 3 秒不弹窗（给视觉判定留时间）', () => {
  const round = {
    id: 3,
    options: ['双刀流', '大法师'],
    currentOptions: ['双刀流', '大法师'],
    confirmed: [],
    closed: true,
    closedAt: Date.now() - 1000,
    dismissed: false,
  };
  assert.equal(augmentConfirmation(baseState(round), []), null);
});

test('确认提示的 id 对同一轮稳定，避免重复弹窗', () => {
  const round = { id: 4, options: ['A', 'B'], currentOptions: ['A', 'B'], confirmed: [], closed: true, closedAt: Date.now() - 5000, dismissed: false };
  const state = baseState(round);
  const first = augmentConfirmation(state, []);
  const second = augmentConfirmation(state, []);
  assert.equal(first.id, second.id);
  assert.equal(first.id, augmentConfirmationId(state, round));
});
