import test from 'node:test';
import assert from 'node:assert/strict';
import { correctMessage, snapName, clockSeconds, garbageRatio, editDistance } from '../chat-correct.mjs';

const players = ['诺天暗淡', 'OB大魔王', '大宝小宝一起上', '幻狸灭'];
const champions = ['法外狂徒', '皮城执法官', '奥瑞利安·索尔', '锦绣菲儿'];
const ctx = { clock: 400, players, champions };

test('时间前缀坏了整行不可信', () => {
  const bad = correctMessage({ kind: 'team_chat', time: 'O5:27', content: '中路来一下', display: 'O5:27 中路来一下' }, ctx);
  assert.equal(bad, null);
});

test('时间超过当前对局时钟不可信', () => {
  const future = correctMessage({ kind: 'team_chat', time: '09:00', content: '中路来一下' }, ctx);
  assert.equal(future, null);
  const ok = correctMessage({ kind: 'team_chat', time: '05:30', content: '中路来一下' }, ctx);
  assert.ok(ok);
});

test('名字错一个字能被吸附回本局名单', () => {
  assert.equal(snapName('OB大魔玉', players), 'OB大魔王');
  assert.equal(snapName('皮城执法宫', champions), '皮城执法官');
});

test('错得太多就不硬认', () => {
  assert.equal(snapName('完全无关的名字', players), null);
  assert.equal(clockSeconds('5:2'), null);
  assert.equal(clockSeconds('05:27'), 327);
});

test('击杀公告认出主语就纠正，认不出就丢', () => {
  const fixed = correctMessage({ kind: 'kill', time: '05:27', killer: 'OB大魔玉', victim: '皮城执法宫' }, ctx);
  assert.equal(fixed.killer, 'OB大魔王');
  assert.equal(fixed.victim, '皮城执法官');
  const dropped = correctMessage({ kind: 'kill', time: '05:27', killer: '完全无关', victim: null }, ctx);
  assert.equal(dropped, null);
});

test('队聊不改玩家原话，但会纠正说话人', () => {
  const message = correctMessage({ kind: 'team_chat', time: '05:30', speaker: '诺天暗谈', content: '中路来一下' }, ctx);
  assert.equal(message.speaker, '诺天暗淡');
  assert.equal(message.content, '中路来一下');
});

test('乱码比例高的行丢掉', () => {
  assert.ok(garbageRatio('?????') > 0.9);
  assert.ok(garbageRatio('中路来一下') < 0.1);
  assert.equal(correctMessage({ kind: 'team_chat', time: '05:30', content: '????????' }, ctx), null);
});

test('编辑距离基本正确', () => {
  assert.equal(editDistance('皮城执法官', '皮城执法宫'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
});

test('整行文本里的名字也能纠回来（解析前修）', async () => {
  const { snapInText } = await import('../chat-correct.mjs');
  const line = '05:27 OB大魔玉(法外狂徒)击杀了MISSI(皮城执法宫)完成了一次三杀!';
  const fixed = snapInText(snapInText(line, ['OB大魔王'], 1), ['法外狂徒', '皮城执法官'], 2);
  assert.match(fixed, /OB大魔王/);
  assert.match(fixed, /法外狂徒/);
  assert.match(fixed, /皮城执法官/);
  assert.equal(fixed.length, line.length, '替换必须等长，不能破坏时间前缀');
});

test('购买公告里的装备名会纠错，认不出就丢', async () => {
  const items = ['凡性的提醒', '黑色切割者', '玛莫提乌斯之噬'];
  const fixed = correctMessage({ kind: 'purchase', time: '05:30', item: '凡性的提酲', champion: '皮城执法宫' }, { ...ctx, items });
  assert.equal(fixed.item, '凡性的提醒');
  assert.equal(fixed.champion, '皮城执法官');
  assert.equal(correctMessage({ kind: 'purchase', time: '05:30', item: '完全不存在的装备' }, { ...ctx, items }), null);
});
