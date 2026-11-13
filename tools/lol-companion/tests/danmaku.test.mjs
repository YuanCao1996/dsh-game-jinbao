import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packFrame, parseFrames, parseDanmaku, createViewerFilter, OP } from '../danmaku-bridge.mjs';
import { viewerReply } from '../viewer-reply.mjs';

// ── 协议解析 ─────────────────────────────────────────────
test('帧打包后能被拆回来', () => {
  const frame = packFrame(OP.MESSAGE, '{"cmd":"DANMU_MSG"}');
  const parsed = parseFrames(frame);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].operation, OP.MESSAGE);
  assert.equal(parsed[0].text, '{"cmd":"DANMU_MSG"}');
});

test('压缩帧（protover=2）能解出多条弹幕', async () => {
  const { deflateSync } = await import('node:zlib');
  const inner = Buffer.concat([
    packFrame(OP.MESSAGE, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], '第一条', [-1, '甲']] })),
    packFrame(OP.MESSAGE, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], '第二条', [-1, '乙']] })),
  ]);
  const compressed = packFrame(OP.MESSAGE, deflateSync(inner), 2);
  const frames = parseFrames(compressed);
  const texts = frames.map(f => parseDanmaku(f.text)).filter(Boolean).map(m => m.text);
  assert.deepEqual(texts, ['第一条', '第二条']);
});

test('弹幕与醒目留言都能解析出用户和内容', () => {
  const danmu = parseDanmaku(JSON.stringify({ cmd: 'DANMU_MSG', info: [[], '主播好', [123, '观众A']] }));
  assert.equal(danmu.user, '观众A');
  assert.equal(danmu.text, '主播好');
  assert.equal(danmu.superChat, false);

  const sc = parseDanmaku(JSON.stringify({ cmd: 'SUPER_CHAT_MESSAGE', data: { message: '加油', uid: 9, price: 30, user_info: { uname: '观众B' } } }));
  assert.equal(sc.user, '观众B');
  assert.equal(sc.price, 30);
  assert.equal(sc.superChat, true);
});

// ── 筛选 ─────────────────────────────────────────────────
test('只有 @金宝 的弹幕才进队列（默认档）', () => {
  const filter = createViewerFilter();
  assert.equal(filter.check({ user: '甲', text: '@金宝 下一件出什么' }).accept, true);
  assert.equal(filter.check({ user: '乙', text: '哈哈这波好搞笑' }).reason, 'no_trigger');
});

test('醒目留言豁免触发词', () => {
  const filter = createViewerFilter();
  assert.equal(filter.check({ user: '丙', text: '打得好', superChat: true, price: 30 }).accept, true);
});

test('刷屏、过短、过长都被拦下', () => {
  const filter = createViewerFilter();
  assert.equal(filter.check({ user: '丁', text: '哈哈哈哈哈哈哈哈哈哈哈哈' }).reason, 'spam');
  assert.equal(filter.check({ user: '戊', text: '@金宝' }).reason, 'too_short');
  assert.equal(filter.check({ user: '己', text: '@金宝 ' + '很'.repeat(80) }).reason, 'too_long');
});

test('同一观众 30 秒内只放行一次；同一句话 60 秒内不重复', () => {
  const filter = createViewerFilter();
  const now = Date.now();
  assert.equal(filter.check({ user: '庚', text: '@金宝 出装' }, now).accept, true);
  assert.equal(filter.check({ user: '庚', text: '@金宝 战绩' }, now + 1000).reason, 'user_rate');
  assert.equal(filter.check({ user: '庚', text: '@金宝 出装' }, now + 31_000).reason, 'duplicate');
  assert.equal(filter.check({ user: '庚', text: '@金宝 出装' }, now + 62_000).accept, true);
});

// ── 观众应答 ─────────────────────────────────────────────
const facts = {
  champion: '赫卡里姆', kda: [12, 4, 18], gold: 2400,
  items: ['朔极之矛', '水银之靴'], nextItem: '振奋盔甲',
  augments: ['钢化你心'], enemies: ['薇恩', '杰斯', '蒙多'],
};

test('战绩类问题用真实 KDA 回答', () => {
  const reply = viewerReply('现在战绩多少', facts);
  assert.ok(reply.includes('12/4/18'), reply);
});

test('出装类问题给下一件', () => {
  assert.ok(viewerReply('下一件出什么', facts).includes('振奋盔甲'));
});

test('问对面时点名真实敌人', () => {
  const reply = viewerReply('对面有谁', facts);
  assert.ok(reply.includes('薇恩'), reply);
});

test('没有对应数据时如实说不知道，不编造', () => {
  const reply = viewerReply('你觉得这把能赢吗', { champion: '赫卡里姆' });
  assert.ok(/正在看|等两秒|看下局势/.test(reply), reply);
  assert.ok(reply.length <= 40);
});
