import test from 'node:test';
import assert from 'node:assert/strict';
import {fixItemNames} from '../item-name-verify.mjs';

const context = ['狂战士胫甲', '兰德里的折磨', '心之钢', '焚天', '魔宗', '朔极之矛'];

test('把本局装备的形近错误名纠正回真实装备名', () => {
  assert.equal(
    fixItemNames('凯尔补了奥拉夫胫甲，走攻速流啦。', context),
    '凯尔补了狂战士胫甲，走攻速流啦。',
  );
});

test('已经正确的装备名不动，也不裁掉前面的动词', () => {
  for (const text of ['出了狂战士胫甲，走攻速流啦。', '发条魔灵出了兰德里的折磨，别贴着兵线打']) {
    assert.equal(fixItemNames(text, context), text);
  }
});

test('普通词“装备”不会被合成不存在的装备名', () => {
  const text = '安妮现在先清线，等队友先手，再根据强化选择下一件装备。';
  assert.equal(fixItemNames(text, context), text);
});

test('本局没出现过的装备名不乱猜', () => {
  assert.equal(fixItemNames('凯尔补了奥拉夫胫甲。', ['无尽之刃']), '凯尔补了奥拉夫胫甲。');
});
