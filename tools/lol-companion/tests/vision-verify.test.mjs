import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisionVerify } from '../vision-verify.mjs';

const catalogue = ['沃格勒特的巫师帽', '风语者的祝福', '扳机炼狱', '可靠武器'];
const image = (now, age = 0) => async (path) => {
  assert.match(path, /vision-(strip|chat)\.jpg$/);
  return { data: Buffer.from('jpeg'), mtimeMs: now - age };
};

function fixture({ now = 1_000_000, age = 0, titles = null, lines = null, fail = false } = {}) {
  const calls = [];
  const assist = {
    async readTitles(request) { calls.push(['titles', request]); return fail ? null : { list: titles, ms: 120, model: 'game-vision' }; },
    async readChat(request) { calls.push(['chat', request]); return fail ? null : { list: lines, ms: 140, model: 'game-vision' }; },
  };
  const verify = createVisionVerify({
    assist,
    catalogue,
    now: () => now,
    freshnessMs: 2000,
    statImpl: image(now, age),
    readFileImpl: async () => Buffer.from('jpeg'),
  });
  return { verify, calls };
}

test('卡名纠正：模型结果吸附到名录后，按 slot 合并回候选', async () => {
  const { verify, calls } = fixture({ titles: ['沃格勒特的巫师帽', '风语者的祝福', '扳机炼狱'] });
  const result = await verify.correctOffer({
    roll: 2,
    options: [{ name: '沃格勒特的巫师帽', slot: 0 }, { name: '风语者的祝福！', slot: 1 }, { name: '扳机炼狱', slot: 2 }],
    stateDir: 'C:/state',
    matchId: 'm',
  });
  assert.ok(result);
  assert.deepEqual(result.names, ['沃格勒特的巫师帽', '风语者的祝福', '扳机炼狱']);
  assert.deepEqual(result.options.map((o) => o.slot), [0, 1, 2]);
  assert.equal(calls.length, 1);
});

test('同一轮只试一次，避免模型读不出来时反复花钱', async () => {
  const { verify, calls } = fixture({ titles: [null, null, null] });
  assert.equal(await verify.correctOffer({ roll: 5, options: [{ name: '甲', slot: 0 }], stateDir: 'C:/state' }), null);
  assert.equal(await verify.correctOffer({ roll: 5, options: [{ name: '甲', slot: 0 }], stateDir: 'C:/state' }), null);
  assert.equal(calls.length, 1);
});

test('吸附不上两个以上就不采纳', async () => {
  const { verify } = fixture({ titles: ['完全不存在的新强化', '另一个不存在的', '扳机炼狱'] });
  assert.equal(await verify.correctOffer({ roll: 7, options: [{ name: 'x', slot: 0 }], stateDir: 'C:/state' }), null);
});

test('截图过期就不去问模型（避免拿旧画面纠正新面板）', async () => {
  const { verify, calls } = fixture({ age: 9000, titles: ['沃格勒特的巫师帽', null, null] });
  assert.equal(await verify.correctOffer({ roll: 9, options: [{ name: '甲', slot: 0 }], stateDir: 'C:/state' }), null);
  assert.equal(calls.length, 0);
});

test('聊天补读：过滤空行，保留可解析的行', async () => {
  const { verify } = fixture({ lines: ['00:51 A：你好', null, '  ', '00:52 B：收到'] });
  const result = await verify.readChat({ stateDir: 'C:/state', matchId: 'm' });
  assert.deepEqual(result.lines, ['00:51 A：你好', '00:52 B：收到']);
});
