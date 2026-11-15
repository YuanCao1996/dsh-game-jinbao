import test from 'node:test';
import assert from 'node:assert/strict';
import { skipStaleHistory, STALE_LOG_MS } from '../overlay-state.mjs';

const NOW = 1794742356235; // 2026-11-15T19:32Z 左右

test('启动时不重放早已结束的对局日志', () => {
  // 20 小时前的 2.37MB 对局日志：必须跳过历史，只跟新写入。
  const mtime = NOW - 20 * 60 * 60 * 1000;
  assert.equal(skipStaleHistory({ size: 2_374_981, mtimeMs: mtime, now: NOW }), true);
});

test('刚写完的日志（换包或重启对局中）仍然从头读，视图不能丢', () => {
  assert.equal(skipStaleHistory({ size: 4096, mtimeMs: NOW - 30_000, now: NOW }), false);
  assert.equal(skipStaleHistory({ size: 4096, mtimeMs: NOW - STALE_LOG_MS + 1000, now: NOW }), false);
});

test('空文件与非法时间戳不触发跳过', () => {
  assert.equal(skipStaleHistory({ size: 0, mtimeMs: NOW - 60 * 60 * 1000, now: NOW }), false);
  assert.equal(skipStaleHistory({ size: 100, mtimeMs: Number.NaN, now: NOW }), false);
  assert.equal(skipStaleHistory(), false);
});

test('阈值是 5 分钟，可覆盖', () => {
  const mtime = NOW - 10 * 60 * 1000;
  assert.equal(skipStaleHistory({ size: 100, mtimeMs: mtime, now: NOW }), true);
  assert.equal(skipStaleHistory({ size: 100, mtimeMs: mtime, now: NOW, maxAgeMs: 30 * 60 * 1000 }), false);
});
