import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudCoach } from '../auto-coach.mjs';

// 多杀播报以前只有固定句式。现在由云端生成一句话，本地文案只在云端没回来时兜底。
test('一条待点评的连杀链会被云端改写一次，并按 praiseChain 落库', async () => {
  const state = { time: 10_000, entries: [], questions: [], asked: 0 };
  const view = () => ({
    game: 'lol', match: 'one', updatedAt: state.time, selfChampion: '安妮',
    pendingPraise: [{
      chain: 'self@1794000000000', streak: 3, side: 'self', hero: '',
      victims: ['锐雯'], revenge: ['锐雯'], at: state.time - 1000,
    }],
  });
  const coach = createCloudCoach({
    view,
    getContext: async () => ({ current: null }),
    now: () => state.time,
    agent: {
      ask: async request => {
        state.asked += 1;
        state.questions.push(request.question);
        return { text: '三杀！锐雯那笔仇报了。' };
      },
    },
    publish: async entry => state.entries.push(entry),
  });

  await coach.tick();
  const praise = state.entries.find(entry => entry.kind === 'praise');
  assert.ok(praise, '云端点评必须写进播报日志');
  assert.equal(praise.praiseChain, 'self@1794000000000', '用连杀链做去重键');
  assert.equal(praise.broadcast, '三杀！锐雯那笔仇报了。');
  assert.equal(praise.priority, 2);
  assert.match(state.questions[0], /3连杀/, '请求必须带上连杀级别');
  assert.match(state.questions[0], /锐雯/, '请求必须带上击杀对象与复仇信息');

  // 同一条链只请求一次模型：下一轮不能再打一次。
  await coach.tick();
  assert.equal(state.asked, 1, '同一条连杀链不能重复请求');
  coach.close();
});

test('云端没给出句子时不补发固定文案，交回本地兜底', async () => {
  const state = { time: 10_000, entries: [], asked: 0 };
  const coach = createCloudCoach({
    view: () => ({
      game: 'lol', match: 'one', updatedAt: state.time, selfChampion: '安妮',
      pendingPraise: [{ chain: 'self@1', streak: 4, side: 'self', hero: '', victims: [], revenge: [], at: state.time }],
    }),
    getContext: async () => ({ current: null }),
    now: () => state.time,
    agent: { ask: async () => { state.asked += 1; throw Error('model down'); } },
    publish: async entry => state.entries.push(entry),
  });
  await coach.tick();
  assert.equal(state.asked, 1);
  assert.equal(state.entries.filter(entry => entry.kind === 'praise').length, 0, '失败时不要写半截文案');
  coach.close();
});
