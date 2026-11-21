import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudCoach } from '../auto-coach.mjs';

// 2026-11-21 起：多杀夸奖改成本地模板直接播，不再走云端生成。
// 这一组用例锁住「教练不再为多杀打模型」这个决定，避免以后又被加回去。
test('多杀夸奖不再请求模型：教练遇到待点评的链也不调用 agent', async () => {
  const state = { time: 10_000, entries: [], asked: 0 };
  const coach = createCloudCoach({
    view: () => ({
      game: 'lol', match: 'one', updatedAt: state.time, selfChampion: '安妮',
      pendingPraise: [{
        chain: 'self@1794000000000', streak: 3, side: 'self', hero: '',
        victims: ['锐雯'], revenge: ['锐雯'], at: state.time - 1000,
      }],
    }),
    getContext: async () => ({ current: null }),
    now: () => state.time,
    agent: { ask: async () => { state.asked += 1; return { text: '不该被调用' }; } },
    publish: async entry => state.entries.push(entry),
  });

  await coach.tick();
  assert.equal(state.asked, 0, '多杀夸奖已本地化，不应再为它打模型');
  assert.equal(state.entries.filter(entry => entry.kind === 'praise').length, 0, '教练不应再写 praise 播报');
  coach.close();
});
