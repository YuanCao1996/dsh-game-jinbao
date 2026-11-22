import test from 'node:test';
import assert from 'node:assert/strict';
import { createAugmentObserver } from '../augment-observer.mjs';

function frame(at, texts) {
  return {
    foreground: true,
    available: true,
    panelOccluded: false,
    capturedAt: at,
    width: 1000,
    height: 1000,
    titleLines: [
      { text: texts[0], x: 300, y: 342, slot: 0 },
      { text: texts[1], x: 500, y: 342, slot: 1 },
    ],
  };
}

test('只认出两张时先等第三张，1.5 秒后才降级发布', () => {
  let now = 1000;
  const emitted = [];
  const observer = createAugmentObserver(
    ['精密发条', '循环引擎', '守护天使'],
    event => emitted.push(event),
    { now: () => now },
  );
  observer.observe(frame(now, ['精密发条', '循环引擎']));
  assert.equal(emitted.some(event => event.kind === 'augment_offer'), false, '不能立刻缺卡发布');

  now += 1600;
  observer.observe(frame(now, ['精密发条', '循环引擎']));
  assert.equal(emitted.some(event => event.kind === 'augment_offer'), false, '第一帧只建立待确认');

  now += 100;
  observer.observe(frame(now, ['精密发条', '循环引擎']));
  const offer = emitted.find(event => event.kind === 'augment_offer');
  assert.ok(offer, '超时后应降级发布两张');
  assert.deepEqual(offer.options.map(option => option.name), ['精密发条', '循环引擎']);
  assert.deepEqual(offer.missingSlots, [2]);
});
