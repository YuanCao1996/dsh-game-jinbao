import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOverlayState, applyOverlayEvent } from '../overlay-state.mjs';

test('队友打字和信号进入聊天时间线', () => {
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
  assert.equal(team.length, 3, '三条都要进聊天时间线');
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
