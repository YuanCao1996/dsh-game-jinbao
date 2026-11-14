import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefSpeech } from '../roles.mjs';

// 出装/强化类建议普遍 80~150 字，过去会被 60 字上限整条丢掉：
// 2026-11-13 实测 17 条出装建议只有 1 条真的被念出来。
// 现在先把「下一件 / 出装顺序 / 怎么玩」的要点抽出来，再交给 60 字上限。

test('下一件建议念成「下一件 X」', () => {
  const line = briefSpeech('下一件：星蚀 —— 先补锯齿短匕，再合成（你还差约700金，目前413）。');
  assert.ok(line.startsWith('下一件'), line);
  assert.ok(line.includes('星蚀'), line);
  assert.ok(line.length <= 20, line);
});

test('「直接合成」也归到下一件', () => {
  const line = briefSpeech('金宝建议：下一件直接合成黑色切割者——用你手上的净蚀＋十字镐，补一把长剑即可。');
  assert.ok(line.includes('黑色切割者'), line);
  assert.ok(!line.includes('合成黑色'), line);
});

test('六件顺序念前三件', () => {
  const line = briefSpeech('潘森（海克斯大乱斗）开局出装 6 件顺序 长剑+红药 → 净蚀 → 焚天 → 水银之靴 → 死亡之舞。');
  assert.ok(line.startsWith('出装'), line);
  assert.ok(line.includes('长剑'), line);
  assert.ok(line.includes('净蚀'), line);
  assert.ok(line.includes('焚天'), line);
  assert.ok(!line.includes('水银'), '只念前三件: ' + line);
});

test('出装顺序同样只念前三件', () => {
  const line = briefSpeech('出装顺序：裂隙制造者→铁板靴→瑞莱冰晶节杖，之后补坦克装。');
  assert.equal(line, '出装 裂隙制造者、铁板靴、瑞莱冰晶节杖');
});

test('普通战术句子原样保留', () => {
  assert.equal(briefSpeech('稳住节奏，别单独追人。'), '稳住节奏，别单独追人。');
});
