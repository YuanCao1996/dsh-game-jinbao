import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadHealthIssue } from '../lib/lol-coaching-plan.js';

// 真机事故：阵亡等复活时播报说「你只剩1%血，先回城补血」。
test('阵亡时声称还有血量会被拦下', () => {
  const hit = deadHealthIssue('你只剩1%血，先回城补血，回来再跟队推中路。');
  assert.ok(hit, '必须拦下');
  assert.equal(hit.kind, 'health-claim');
});

test('阵亡时让玩家回城会被拦下', () => {
  const hit = deadHealthIssue('先回城补血，等复活再进场。');
  assert.ok(hit);
  assert.equal(hit.kind, 'dead-action');
});

test('「倒下时只剩1%」这种过去时说法不拦', () => {
  assert.equal(deadHealthIssue('倒下时只剩1%血，复活后先出负极斗篷。'), null);
});

test('正常复活后建议不拦', () => {
  assert.equal(deadHealthIssue('复活后先出负极斗篷，跟盖伦一起压蒙多。'), null);
});

test('存活时的回城建议不在此闸范围内（由调用方按 dead 决定是否启用）', () => {
  assert.ok(deadHealthIssue('先回城补血'));
});
