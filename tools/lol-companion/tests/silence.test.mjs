import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldEndOnSilence, silenceEndEvents, SILENCE_END_MS } from '../silence.mjs';

const NOW = 1794742991110;

test('静默超过阈值判本局结束', () => {
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - SILENCE_END_MS }), true);
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - SILENCE_END_MS - 1 }), true);
});

test('正常每秒钟都有数据时不判结束', () => {
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - 1000 }), false);
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - SILENCE_END_MS + 1 }), false);
});

test('还没拿到过对局数据（lastDataAt=0）或时间非法时不判结束', () => {
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: 0 }), false);
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: Number.NaN }), false);
  assert.equal(shouldEndOnSilence({ now: Number.NaN, lastDataAt: NOW - 999999 }), false);
  assert.equal(shouldEndOnSilence(), false);
});

test('一局只判一次：已经结束过就不再重复', () => {
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - 999999, ended: true }), false);
});

test('阈值可覆盖，非法阈值按不判处理', () => {
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - 5000, threshold: 1000 }), true);
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - 5000, threshold: 0 }), false);
  assert.equal(shouldEndOnSilence({ now: NOW, lastDataAt: NOW - 5000, threshold: Number.NaN }), false);
});

test('静默结束只补 phase 标记，不带胜负', () => {
  const events = silenceEndEvents({ silentForMs: 150000, gameTime: '08:19' });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'phase');
  assert.equal(events[0].phase, 'EndOfGame');
  assert.equal(events[0].reason, 'collector_silence');
  assert.equal(events[0].silentForMs, 150000);
  assert.equal('Result' in events[0], false, '静默结束不能上报胜负');
});
