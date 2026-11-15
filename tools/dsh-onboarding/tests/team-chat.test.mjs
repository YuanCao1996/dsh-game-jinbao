import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOverlayState, applyOverlayEvent, overlayView } from '../overlay-state.mjs';

test('队友打字和信号进入数据层（标记为不上屏）', () => {
  const state = initialOverlayState();
  state.game = 'lol'; state.match = 'm1'; state.matchStartedAt = 1; state.at = Date.now();
  applyOverlayEvent(state, {
    game: 'lol', match: 'm1', kind: 'chat_events', at: Date.now(),
    events: [
      { kind: 'team_chat', speaker: '诺天暗淡', text: '中路来一下', time: '05:30', self: false },
      { kind: 'team_chat', speaker: '我自己', text: '等我两波', time: '05:31', self: true },
      { kind: 'ping', champion: '法外狂徒', time: '05:32' },
    ],
  }, 'live.jsonl');
  const team = state.chat.filter(row => row.origin === 'team');
  assert.equal(team.length, 3, '三条都要进数据层');
  assert.equal(team[0].displayName, '诺天暗淡');
  assert.equal(team[0].text, '中路来一下');
  assert.equal(team[1].self, true, '自己说的话要标记 self');
  assert.equal(team[2].text, '点了信号');
  assert.equal(team[2].displayName, '法外狂徒');
});

test('空聊天不写入', () => {
  const state = initialOverlayState();
  state.game = 'lol'; state.match = 'm1'; state.matchStartedAt = 1; state.at = Date.now();
  applyOverlayEvent(state, { game: 'lol', match: 'm1', kind: 'chat_events', at: Date.now(), events: [{ kind: 'team_chat', text: '   ' }] }, 'live.jsonl');
  assert.equal(state.chat.filter(row => row.origin === 'team').length, 0);
});

test('识别到的队聊只进教练上下文，不上悬浮窗', () => {
  const state = initialOverlayState();
  state.game = 'lol'; state.match = 'm1'; state.matchStartedAt = 1; state.at = Date.now();
  applyOverlayEvent(state, {
    game: 'lol', match: 'm1', kind: 'chat_events', at: Date.now(),
    events: [
      { kind: 'team_chat', speaker: '诺天暗淡', text: '中路来一下', time: '05:30' },
      { kind: 'ping', champion: '法外狂徒', time: '05:32' },
    ],
  }, 'live.jsonl');
  const view = overlayView(state, { rows: [], loading: false });
  assert.equal(view.chatRows.length, 0, '悬浮窗聊天区不能出现识别到的聊天');
  assert.ok(!String(view.chat ?? '').includes('中路来一下'), '对话摘要里也不该出现');
  const team = state.chat.filter(row => row.origin === 'team');
  assert.equal(team.length, 2, '数据仍要留给教练上下文');
  assert.ok(team.every(row => row.hidden === true));
});
