import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createVisionAssist, resolveVisionTier, snapAugmentName, VISION_TIERS, DEFAULT_VISION_TIER,
} from '../vision-assist.mjs';

const answer = (content) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });
const jpeg = (value = 'a') => ({ data: Buffer.from(value), mimeType: 'image/jpeg' });
const tempDir = () => mkdtempSync(join(tmpdir(), 'jinbao-vision-'));

test('未知档位回落到默认档，并且档位额度是商业化配置的唯一来源', () => {
  assert.equal(resolveVisionTier('nope'), DEFAULT_VISION_TIER);
  assert.equal(resolveVisionTier('plus'), 'plus');
  for (const tier of Object.values(VISION_TIERS)) {
    assert.ok(tier.augmentPerMatch > 0 && tier.chatPerMatch > 0 && tier.callsPerDay > 0);
  }
});

test('卡名补读：只解析 JSON 里的 titles，并把结果记进当日额度', async () => {
  const stateDir = tempDir();
  const assist = createVisionAssist({
    stateDir, getToken: async () => 'jc_test', tier: 'basic',
    fetchImpl: answer('{"titles":["沃格勒特的巫师帽",null,"扳机炼狱"]}'),
  });
  const result = await assist.readTitles({ image: jpeg(), matchId: 'm1' });
  assert.deepEqual(result.list, ['沃格勒特的巫师帽', null, '扳机炼狱']);
  const stats = assist.stats();
  assert.equal(stats.calls, 1);
  assert.equal(stats.matches.m1.augment, 1);
});

test('同一张图不会重复花钱，即使调用方重复触发', async () => {
  let calls = 0;
  const assist = createVisionAssist({
    stateDir: tempDir(), getToken: async () => 'jc_test',
    fetchImpl: async (...args) => { calls += 1; return answer('{"titles":["a",null,null]}')(...args); },
  });
  const image = jpeg('same');
  assert.ok(await assist.readTitles({ image, matchId: 'm1' }));
  assert.equal(await assist.readTitles({ image, matchId: 'm1' }), null);
  assert.equal(calls, 1);
});

test('每局额度用尽后不再调用，命中 match_limit', async () => {
  let calls = 0;
  const logs = [];
  const assist = createVisionAssist({
    stateDir: tempDir(), getToken: async () => 'jc_test', tier: 'free', log: (row) => logs.push(row),
    fetchImpl: async (...args) => { calls += 1; return answer('{"titles":["a",null,null]}')(...args); },
  });
  for (let i = 0; i < VISION_TIERS.free.augmentPerMatch + 3; i += 1) {
    await assist.readTitles({ image: jpeg('img' + i), matchId: 'm1' });
  }
  assert.equal(calls, VISION_TIERS.free.augmentPerMatch);
  assert.ok(logs.some((row) => row.reason === 'match_limit'));
});

test('当日额度跨实例、跨局累计，超了就停', async () => {
  const stateDir = tempDir();
  const assist = createVisionAssist({
    stateDir, getToken: async () => 'jc_test', tier: 'free',
    fetchImpl: answer('{"lines":["a"]}'),
  });
  let ok = 0;
  for (let i = 0; i < VISION_TIERS.free.callsPerDay + 2; i += 1) {
    const result = await assist.readChat({ image: jpeg('chat' + i), matchId: 'm' + i });
    if (result) ok += 1;
  }
  assert.equal(ok, VISION_TIERS.free.callsPerDay);
  const saved = JSON.parse(readFileSync(join(stateDir, 'vision-assist-usage.json'), 'utf8'));
  assert.equal(saved.calls, VISION_TIERS.free.callsPerDay);
});

test('连续失败两次就熔断本局，避免对着坏网络反复花钱', async () => {
  const assist = createVisionAssist({
    stateDir: tempDir(), getToken: async () => 'jc_test',
    fetchImpl: async () => { throw Object.assign(Error('boom'), { code: 'ECONNRESET' }); },
  });
  assert.equal(await assist.readTitles({ image: jpeg('1'), matchId: 'm1' }), null);
  assert.equal(await assist.readTitles({ image: jpeg('2'), matchId: 'm1' }), null);
  assert.equal(await assist.readTitles({ image: jpeg('3'), matchId: 'm1' }), null);
  assert.equal(assist.stats().failures, 2);
});

test('没有令牌、被关闭或图片为空时什么都不发', async () => {
  let calls = 0;
  const count = async () => { calls += 1; return answer('{}')(); };
  const noToken = createVisionAssist({ stateDir: tempDir(), getToken: async () => undefined, fetchImpl: count });
  assert.equal(await noToken.readTitles({ image: jpeg('x'), matchId: 'm' }), null);
  const disabled = createVisionAssist({ stateDir: tempDir(), enabled: false, getToken: async () => 'jc_test', fetchImpl: count });
  assert.equal(await disabled.readChat({ image: jpeg('y'), matchId: 'm' }), null);
  const empty = createVisionAssist({ stateDir: tempDir(), getToken: async () => 'jc_test', fetchImpl: count });
  assert.equal(await empty.readTitles({ image: { data: Buffer.alloc(0) }, matchId: 'm' }), null);
  assert.equal(calls, 0);
});

test('模型回来的不是约定 JSON 就丢弃，不把散文当卡名', async () => {
  const assist = createVisionAssist({
    stateDir: tempDir(), getToken: async () => 'jc_test',
    fetchImpl: answer('```json\n{"titles":["钢化你心","闪现向前"]}\n```'),
  });
  const parsed = await assist.readTitles({ image: jpeg('fence'), matchId: 'm' });
  assert.deepEqual(parsed.list, ['钢化你心', '闪现向前']);
  const bad = createVisionAssist({
    stateDir: tempDir(), getToken: async () => 'jc_test',
    fetchImpl: answer('我看到三张卡，第一张是钢化你心'),
  });
  assert.equal(await bad.readTitles({ image: jpeg('prose'), matchId: 'm' }), null);
});

test('卡名吸附：空格/标点/异体字能对上，名录里没有的绝不硬凑', () => {
  const catalogue = ['沃格勒特的巫师帽', '奥术公理', '扳机炼狱', '钢化你心'];
  assert.equal(snapAugmentName('沃格勒特的巫师帽', catalogue).name, '沃格勒特的巫师帽');
  assert.equal(snapAugmentName('奥 术 公 理', catalogue).name, '奥术公理');
  assert.equal(snapAugmentName('奧术公理', catalogue).name, '奥术公理');
  assert.equal(snapAugmentName('扳机炼狱！', catalogue).name, '扳机炼狱');
  assert.equal(snapAugmentName('完全不存在的新强化', catalogue), null);
});

test('先请求关闭思考；网关不认这个字段时自动降级重发，并记住结论', async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.thinking) return { ok: false, status: 400, text: async () => '{"error":"bad_request"}' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"titles":["沃格勒特的巫师帽",null,null]}' } }] }) };
  };
  const assist = createVisionAssist({ stateDir: tempDir(), getToken: async () => 'jc_test', fetchImpl });
  const first = await assist.readTitles({ image: jpeg('one'), matchId: 'm1' });
  assert.ok(first, '降级后应该拿到结果');
  assert.equal(bodies.length, 2, '第一次带 thinking 被拒，应重发一次');
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  assert.equal(bodies[1].thinking, undefined);
  assert.equal(assist.stats().thinking, 'off', '本进程内记住网关不支持');
  // 第二次请求不再白试 thinking
  await assist.readTitles({ image: jpeg('two'), matchId: 'm1' });
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].thinking, undefined);
  assert.equal(assist.stats().calls, 2, '被拒的请求不记账');
});