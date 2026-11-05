import test from 'node:test';
import assert from 'node:assert/strict';
import {hextechLeaderboardPage, heroLeaderboardPage, topRuneId, padDisplay} from '../leaderboard-pages.mjs';

// 夹具取自生产真实返回（见 handoff/leaderboard-api.md）。

const hextech = [
  {rank: 1, tier: 'T1', name: '升级：无尽之刃', winRate: 44.22, pickRate: 19.4, champion: '影哨 阿克尚'},
  {rank: 1, tier: 'T1', name: '灵魂虹吸', winRate: 60.61, pickRate: 19.57, champion: '封魔剑魂 永恩'},
];

const heroes = [
  {rank: 1, name: '亚索', title: '疾风剑豪', tier: 2, winRate: 52.3, augmentStats: '[{"augmentId":157,"rank":1}]'},
  {rank: 1, name: '赫卡里姆', title: '战争之影', tier: 1, winRate: 58.1, augmentStats: [{augmentId: 27, rank: 1}]},
];

test('海克斯榜：一行一条，无排名/井号/选取率/适配二字，只看英雄名', () => {
  const lines = hextechLeaderboardPage(hextech).split('\n');
  assert.equal(lines.length, 4, '标题两行 + 两条数据');
  assert.doesNotMatch(lines[2], /#/);
  assert.doesNotMatch(lines[2], /选取/);
  assert.doesNotMatch(lines[2], /适配/);
  assert.match(lines[2], /^T1 +灵魂虹吸 +60\.6% +永恩$/);
  assert.match(lines[3], /^T1 +升级：无尽之刃 +44\.2% +阿克尚$/);
});

test('英雄榜：一行一条，不显示称号，带顶级符文', () => {
  const page = heroLeaderboardPage(heroes, {topRune: (row) => (topRuneId(row) === 157 ? '灵魂虹吸' : '易损')});
  const lines = page.split('\n');
  assert.match(lines[2], /^T1 +赫卡里姆 +58\.1% +易损$/);
  assert.match(lines[3], /^T2 +亚索 +52\.3% +灵魂虹吸$/);
  assert.doesNotMatch(page, /战争之影|疾风剑豪/);
});

test('按显示宽度对齐：同列起始位置一致（中文占两列）', () => {
  const lines = heroLeaderboardPage(heroes, {topRune: () => '符'}).split('\n').slice(2);
  const width = (s) => [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1), 0);
  const prefix = (s) => width(s.slice(0, s.indexOf(' ' + s.trim().split(/ +/)[2])));
  assert.equal(width(lines[0]), width(lines[1]), '两行总宽（含中文）应一致');
  const padded = padDisplay('亚索', 18);
  assert.equal(padded.length, 16, '两个汉字占 4 列，补 14 个空格 = 16 个字符');
  assert.equal(width(padded), 18, '补完后显示宽度正好 18 列');
});

test('缺字段时用 — 占位，不崩', () => {
  const lines = hextechLeaderboardPage([{name: '甲'}]).split('\n');
  assert.match(lines[2], /^— +甲 +—/);
});

test('空数据返回空串，交给调用方退回原文案', () => {
  assert.equal(hextechLeaderboardPage([]), '');
  assert.equal(heroLeaderboardPage(null), '');
});

test('顶级符文取 augmentStats 里 rank 最小的一条', () => {
  assert.equal(topRuneId(heroes[0]), 157);
  assert.equal(topRuneId(heroes[1]), 27);
  assert.equal(topRuneId({augmentStats: 'not-json'}), null);
});
