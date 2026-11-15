import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudContext } from '../cloud-agent.mjs';

test('教练上下文带上最近的队友聊天', () => {
  const at = Date.now();
  const memory = {
    current: {
      game: 'lol', match: 'm1', at, gameSeconds: 300, me: { champion: '安妮', level: 8 },
      chat: [
        { role: 'user', origin: 'team', displayName: '诺天暗淡', text: '中路来一下', self: false, at },
        { role: 'assistant', text: '按我说的走', at },
      ],
    },
    preferences: [],
  };
  const context = cloudContext(memory, 'lol', 'm1');
  const team = context.client_context.team_chat;
  assert.equal(team.length, 1, '只带 origin=team 的行');
  assert.equal(team[0].who, '诺天暗淡');
  assert.equal(team[0].text, '中路来一下');
});
