import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineupOf, adviceNameIssues, namesInText, describeIssues } from '../lib/advice-names.js';

const current = {
  me: { champion: '战争之影' },
  allies: [{ champion: '德玛西亚之力' }, { champion: '堕落天使' }],
  enemies: [{ champion: '解脱者' }, { champion: '黑暗之女' }, { champion: '祖安狂人' }, { champion: '不屈之枪' }, { champion: '河流之王' }],
};

test('lineupOf 合并双方名单并去重', () => {
  const lineup = lineupOf(current);
  assert.equal(lineup.self, '战争之影');
  assert.deepEqual(lineup.enemies, ['解脱者', '黑暗之女', '祖安狂人', '不屈之枪', '河流之王']);
  assert.ok(lineup.all.includes('德玛西亚之力'));
  assert.ok(lineup.all.includes('战争之影'));
  assert.equal(new Set(lineup.all).size, lineup.all.length);
});

test('namesInText 把本名归一化到称号', () => {
  const found = namesInText('敌方安妮和黑暗之女三法伤，避开蒙多');
  const titles = found.map(item => item.title).sort();
  assert.deepEqual(titles, ['黑暗之女', '祖安狂人'].sort());
});

test('真机事故：编造名单外英雄 + 同一英雄双名都会被拦下', () => {
  const text = '金币1984，下一次可购买时优先做振奋盔甲：敌方安妮、乐芙兰、黑暗之女三法伤，魔抗必补。';
  const issues = adviceNameIssues(text, lineupOf(current));
  assert.deepEqual(issues.unknown, ['诡术妖姬']);
  assert.equal(issues.aliased.length, 1);
  assert.equal(issues.aliased[0].title, '黑暗之女');
  assert.match(describeIssues(issues), /名单外英雄/);
  assert.match(describeIssues(issues), /同一英雄多种写法/);
});

test('正常播报不受影响', () => {
  const text = '复活后跟盖伦一起压制蒙多，别单独追潘森。';
  const issues = adviceNameIssues(text, lineupOf(current));
  assert.deepEqual(issues.unknown, []);
  assert.deepEqual(issues.aliased, []);
});

test('名单外的队友式说法也会被抓到', () => {
  const text = '压低薇恩、杰斯的暴击伤害。';
  const issues = adviceNameIssues(text, lineupOf(current));
  assert.deepEqual(issues.unknown.sort(), ['暗夜猎手', '未来守护者'].sort());
});

test('只写别称时不算越界', () => {
  const issues = adviceNameIssues('敌方安妮的法伤很高。', lineupOf(current));
  assert.deepEqual(issues.unknown, []);
  assert.deepEqual(issues.aliased, []);
});
