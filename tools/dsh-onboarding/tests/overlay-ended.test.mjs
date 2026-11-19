import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlayEvent, initialOverlayState } from '../overlay-state.mjs';

function liveState() {
  const state = initialOverlayState();
  state.game = 'lol';
  state.match = 'lol-live-1.jsonl#1';
  state.matchStartedAt = 1;
  state.at = 1794746100000;
  state.phase = 'InProgress';
  state.gameSeconds = 1030;
  return state;
}

test('GameEnd 事件把对局置为已结束', () => {
  const state = liveState();
  applyOverlayEvent(state, { kind: 'state', game: 'lol', at: 1794746101000, match: 'lol-live-1.jsonl#1', me: { champion: '盲僧' }, state: { time: 1030 } }, 'lol-live-1.jsonl');
  assert.equal(state.ended, false);
  applyOverlayEvent(state, { kind: 'event', game: 'lol', at: 1794746172000, name: 'GameEnd', time: 1034 }, 'lol-live-1.jsonl');
  assert.equal(state.ended, true, '实测 20:36:12 有 GameEnd，但视图仍是 InProgress');
});

test('结束之后不会再被 state 行翻回进行中', () => {
  const state = liveState();
  applyOverlayEvent(state, { kind: 'event', game: 'lol', at: 1794746172000, name: 'GameEnd', time: 1034 }, 'lol-live-1.jsonl');
  applyOverlayEvent(state, { kind: 'state', game: 'lol', at: 1794746175000, match: 'lol-live-1.jsonl#1', me: { champion: '盲僧' }, state: { time: 1036 } }, 'lol-live-1.jsonl');
  assert.equal(state.ended, true, '结束状态必须是粘性的，后续 state 行不能翻回未结束');
});

test('普通事件不会误判结束', () => {
  const state = liveState();
  applyOverlayEvent(state, { kind: 'event', game: 'lol', at: 1794746102000, name: 'ChampionKill', time: 900 }, 'lol-live-1.jsonl');
  assert.equal(state.ended, false);
});

test('胜负跟着 GameEnd 落到对局摘要里（148 局 result 全空就是这里断的）', async () => {
  const { overlayView } = await import('../overlay-state.mjs');
  const { summarizeMatch } = await import('../../dsh-coach-server/lib/match-summary.js');
  const state = liveState();
  applyOverlayEvent(state, { kind: 'state', game: 'lol', at: 1794746101000, match: 'lol-live-1.jsonl#1', me: { champion: '盲僧' }, state: { time: 1030 } }, 'lol-live-1.jsonl');
  applyOverlayEvent(state, { kind: 'event', game: 'lol', at: 1794746172000, name: 'GameEnd', time: 1034, Result: 'Win' }, 'lol-live-1.jsonl');
  const view = overlayView(state, {});
  assert.equal(view.matchWin, true, '快照里必须带上胜负');
  assert.equal(summarizeMatch(view).result, 'win');

  const lost = liveState();
  applyOverlayEvent(lost, { kind: 'state', game: 'lol', at: 1794746101000, match: 'lol-live-1.jsonl#1', me: { champion: '盲僧' }, state: { time: 1030 } }, 'lol-live-1.jsonl');
  applyOverlayEvent(lost, { kind: 'event', game: 'lol', at: 1794746172000, name: 'GameEnd', time: 1034, Result: 'Lose' }, 'lol-live-1.jsonl');
  assert.equal(summarizeMatch(overlayView(lost, {})).result, 'loss');
});
