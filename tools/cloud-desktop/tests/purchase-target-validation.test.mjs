import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseAdviceProblem} from '../auto-coach.mjs';
import {fixItemNames} from '../item-name-verify.mjs';

const current = {
  ownedAugments: ['风暴狂涌'],
  offers: [{name: '巫师式思考'}],
  augmentRounds: [{options: ['巫师式思考', '练腿日']}],
};

test('强化不能作为可购买装备出现在播报里', () => {
  assert.equal(purchaseAdviceProblem('优先补巫师式思考，法强能拉到普攻特效', current), 'augment:巫师式思考');
  assert.equal(purchaseAdviceProblem('下一件成装冲三相之力', current), '');
});

test('散件/组件装备不能出现在播报里', () => {
  assert.equal(purchaseAdviceProblem('回家把缚炉之斧升级成三相之力', current), 'component:缚炉之斧');
  assert.equal(purchaseAdviceProblem('先出破败王者之刃', current), '');
});

test('常见装备误写会纠正为正式名', () => {
  assert.equal(fixItemNames('先出三项之力', []), '先出三相之力');
});
