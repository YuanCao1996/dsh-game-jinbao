import test from 'node:test';
import assert from 'node:assert/strict';
import { clockGlitch, startsNewMatch } from '../match-clock.mjs';

test('时钟被打回 0 或几秒，视为读数瞬断', () => {
  assert.equal(clockGlitch(0, 828), true);
  assert.equal(clockGlitch(3, 828), true);
  assert.equal(clockGlitch(59, 181), true, '一局已过 3 分钟，报 59 秒同样不可能');
  assert.equal(clockGlitch(0, 30), false, '开局前 30 秒的 0 不算瞬断');
  assert.equal(clockGlitch(828, 800), false, '正常前进不算');
  assert.equal(clockGlitch(120, 828), false, '120 秒已经不是瞬断量级');
});

test('开局前没有基线时才开新局', () => {
  assert.equal(startsNewMatch({ time: 0, previous: null }), true);
  assert.equal(startsNewMatch({ time: 5, previous: undefined }), true);
});

test('真机事故：13:48 的瞬断不能拆成两局', () => {
  assert.equal(startsNewMatch({ time: 0, previous: 828, sinceLastDataMs: 1000 }), false);
  assert.equal(startsNewMatch({ time: 3, previous: 828, sinceLastDataMs: 1000 }), false);
});

test('断流 30 秒后重新开始算新局（真重开一定伴随空窗）', () => {
  assert.equal(startsNewMatch({ time: 5, previous: 828, sinceLastDataMs: 45000 }), true);
  assert.equal(startsNewMatch({ time: 0, previous: 828, sinceLastDataMs: 45000 }), true);
});

test('小幅回退不算新局，大幅回退（>90 秒且无空窗）算', () => {
  assert.equal(startsNewMatch({ time: 250, previous: 300, sinceLastDataMs: 1000 }), false);
  assert.equal(startsNewMatch({ time: 200, previous: 300, sinceLastDataMs: 1000 }), true);
});

test('显式 nextMatch（结算/换局）直接放行', () => {
  assert.equal(startsNewMatch({ time: 400, previous: 300, nextMatch: true }), true);
});

test('时钟非法时不误判', () => {
  assert.equal(startsNewMatch({ time: Number.NaN, previous: 300 }), false);
  assert.equal(startsNewMatch({ time: 300, previous: Number.NaN }), true, '没有基线就按新局处理');
});
