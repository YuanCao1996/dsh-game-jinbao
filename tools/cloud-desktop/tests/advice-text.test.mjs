import test from 'node:test';
import assert from 'node:assert/strict';
import {condenseAdvice, stripSources} from '../advice-text.mjs';

// 真实数据：66 条播报平均 167 字、最长 533 字，35 条带段落。模型不会遵守"最多两句"，
// 所以播报正文在这里做确定性收敛。

test('多段落与 Markdown 被拆成短句小节', () => {
  const value = '**下一件优先：锯齿短匕**\n\n本局确认强化只有循环往复。\n\n该强化没有可核实数值，因此不当作伤害加成。';
  const out = condenseAdvice(value);
  const beats = out.split('\n');
  assert.ok(beats.length >= 2, '应当拆成多个小节: ' + out);
  for (const beat of beats) assert.ok(Array.from(beat).length <= 20, '每节不超过 20 字: ' + beat);
  assert.doesNotMatch(out, /\*\*/);
  assert.ok(out.length <= 68, out);
});

test('最多三个小节，每节一句', () => {
  const out = condenseAdvice('先退到塔后。等锐雯大招落空再上前。血量低于四成先撤。');
  assert.deepEqual(out.split('\n'), ['先退到塔后。', '等锐雯大招落空再上前。', '血量低于四成先撤。']);
});

test('超长单句截断在逗号处并补句号', () => {
  const long = '先清完兵线再跟队友进场，保留控制技能，等对面交出关键位移后再接团，然后立刻转中推塔，不要在中路纠缠太久以免被反打，也别在河道里等视野，回城补装备更稳';
  const out = condenseAdvice(long);
  assert.ok(Array.from(out.replace(/\n/g, '')).length <= 72, out);
  assert.ok(out.split('\n').length <= 3, out);
});

test('空输入与纯空白返回空串', () => {
  assert.equal(condenseAdvice(''), '');
  assert.equal(condenseAdvice('   \n\n '), '');
});

test('英文与分号同样被拆成小节', () => {
  const out = condenseAdvice('Push the wave first. Then recall; buy Wand.');
  assert.ok(out.split('\n').length >= 2, out);
  assert.match(out, /Push the wave first/);
});

test('来源、链接与免责尾巴一律剥离', () => {
  const raw = '先补虚空之杖，锐雯的魔抗会被吃穿。来源Hexdata Patch 16.21，版本未经核实，仅供参考。\n来源（版本未经核实）：https://hexdata.com.cn/hero/887-gwen';
  const out = stripSources(raw);
  assert.doesNotMatch(out, /来源|hexdata|http/);
  assert.match(out, /先补虚空之杖/);
  // 收敛后同样干净
  assert.doesNotMatch(condenseAdvice(raw), /来源|http/);
});

test('加粗星号与井号不进入悬浮窗', () => {
  const raw = '**离群之刺（阿卡丽）**：4/2/4，已到 7 级。\n\n其次**邪法小法师** 2/1/5，控制最多。\n# 顺带提醒';
  const out = stripSources(raw);
  assert.doesNotMatch(out, /\*\*/);
  assert.doesNotMatch(out, /^#/m);
  assert.match(out, /离群之刺（阿卡丽）：4\/2\/4/);
  assert.match(out, /邪法小法师/);
});

test('人数清点与就位类播报算噪音', async () => {
  const { noiseBroadcast } = await import('../advice-text.mjs');
  assert.equal(noiseBroadcast('我方5人已就位'), true);
  assert.equal(noiseBroadcast('敌方三人已到齐'), true);
  assert.equal(noiseBroadcast('十人到齐，直接开'), true);
  assert.equal(noiseBroadcast('我方双人还在复活，先回城补状态'), false, '带复活/行动的不算清点');
  assert.equal(noiseBroadcast('先推中路二塔，别深追'), false);
  assert.equal(noiseBroadcast(''), false);
});
