import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hextechLeaderboardPage,
  heroLeaderboardPage,
  topRuneId,
  padDisplay,
  padDisplayLeft,
  leaderboardRowData,
} from '../leaderboard-pages.mjs';

// 夹具取自生产真实返回。
const hextech = [
  {rank: 1, tier: 'T1', name: '灵魂虹吸', winRate: 60.61, champion: '封魔剑魂 永恩'},
  {rank: 2, tier: 'T1', name: '升级：无尽之刃', winRate: 44.22, champion: '影哨 阿克尚'},
  {rank: 3, tier: 'T1', name: '灵魂虹吸', winRate: 51.0, champion: '机械公敌 兰博'},
];

const heroes = [
  {rank: 1, name: '赫卡里姆', title: '战争之影', tier: 1, winRate: 58.1},
  {rank: 2, name: '亚索', title: '疾风剑豪', tier: 2, winRate: 9.9},
];

test('海克斯总榜：单行结构「品质 + 名称 · 胜率」，无井号/选取率/适配二字', () => {
  const lines = hextechLeaderboardPage(hextech).split('\n');
  assert.equal(lines.length, 4, '标题两行 + 两条（同名去重后）');
  assert.match(lines[2], /^T1 +灵魂虹吸 · 60\.6%$/);
  assert.doesNotMatch(lines[2], /#|选取|适配/);
  assert.match(lines[3], /^T1 +升级：无尽之刃 · 44\.2%$/);
});

test('英雄总榜：同样单行结构，不显示称号', () => {
  const lines = heroLeaderboardPage(heroes).split('\n');
  assert.match(lines[2], /^T1 +赫卡里姆 · 58\.1%$/);
  assert.match(lines[3], /^T2 +亚索 · 9\.9%$/);
  assert.doesNotMatch(lines.join('\n'), /战争之影|疾风剑豪/);
});

test('品质列宽度固定：T1 与 T3 后面的名称起始位置一致', () => {
  const lines = heroLeaderboardPage(heroes).split('\n').slice(2);
  const starts = lines.map((line) => line.indexOf('赫') >= 0 ? line.indexOf('赫') : line.indexOf('亚'));
  assert.equal(new Set(starts).size, 1, '名称列起点一致');
  assert.equal(padDisplay('亚索', 18).length, 16, '两个汉字补到 18 显示列 = 16 字符');
  assert.equal(padDisplayLeft('9.9%', 6), '  9.9%', '数值右对齐');
});

test('缺字段时用 — 占位，不崩', () => {
  const lines = hextechLeaderboardPage([{name: '甲'}]).split('\n');
  assert.match(lines[2], /^— +甲 · —$/);
});

test('空数据返回空串', () => {
  assert.equal(hextechLeaderboardPage([]), '');
  assert.equal(heroLeaderboardPage(null), '');
});

test('同名强化只出现一次（整榜是强化×英雄组合）', () => {
  const lines = hextechLeaderboardPage(hextech).split('\n').slice(2);
  assert.equal(lines.filter((line) => line.includes('灵魂虹吸')).length, 1);
});

test('顶级符文取 augmentStats 里 rank 最小的一条', () => {
  assert.equal(topRuneId({augmentStats: '[{"augmentId":157,"rank":1}]'}), 157);
  assert.equal(topRuneId({augmentStats: 'not-json'}), null);
  assert.equal(topRuneId(null), null);
});

test('表格行数据：去重、降序、可带适配英雄', () => {
  const rows = leaderboardRowData(hextech, {limit: 10, withChampion: true});
  assert.deepEqual(rows.map((row) => row.name), ['灵魂虹吸', '升级：无尽之刃']);
  assert.equal(rows[0].winRate, '60.6%');
  assert.equal(rows[0].champion, '永恩');
});
