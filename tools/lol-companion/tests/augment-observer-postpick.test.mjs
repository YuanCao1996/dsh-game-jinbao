import test from 'node:test';
import assert from 'node:assert/strict';
import { createAugmentObserver } from '../augment-observer.mjs';

function frame(at, names) {
  return {
    foreground: true,
    available: true,
    panelOccluded: false,
    capturedAt: at,
    width: 1000,
    height: 1000,
    titleLines: names.map((text, slot) => ({ text, x: 300 + slot * 200, y: 342, slot })),
  };
}

test('选出强化后进入 6 秒静默，残留文字不会伪装成 reroll', () => {
  let now = 1000;
  const emitted = [];
  const observer = createAugmentObserver(
    ['甲卡', '乙卡', '丙卡', '丁卡', '戊卡', '己卡'],
    event => emitted.push(event),
    { now: () => now },
  );
  observer.observe(frame(now, ['甲卡', '乙卡', '丙卡']));
  now += 100;
  observer.observe(frame(now, ['甲卡', '乙卡', '丙卡']));
  const first = emitted.find(event => event.kind === 'augment_offer');
  assert.ok(first, '第一轮应识别成功');

  observer.markPicked();
  now += 1000;
  observer.observe(frame(now, ['丁卡', '戊卡', '己卡']));
  now += 100;
  observer.observe(frame(now, ['丁卡', '戊卡', '己卡']));
  assert.equal(emitted.filter(event => event.kind === 'augment_offer').length, 1, '静默期内不能发新 offer');

  now += 6000;
  observer.observe(frame(now, []));
  now += 100;
  observer.observe(frame(now, ['丁卡', '戊卡', '己卡']));
  now += 100;
  observer.observe(frame(now, ['丁卡', '戊卡', '己卡']));
  const offers = emitted.filter(event => event.kind === 'augment_offer');
  assert.equal(offers.length, 2, '静默期结束后应识别下一轮');
  assert.deepEqual(offers[1].options.map(option => option.name), ['丁卡', '戊卡', '己卡']);
});
