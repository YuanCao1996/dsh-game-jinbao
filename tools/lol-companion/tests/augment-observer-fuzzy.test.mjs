import test from 'node:test';
import assert from 'node:assert/strict';
import { createAugmentObserver } from '../augment-observer.mjs';

test('OCR 读错一个字时按唯一候选纠正，不丢卡', () => {
  const emitted = [];
  const observer = createAugmentObserver(
    ['精密发条', '循环引擎', '守护天使'],
    event => emitted.push(event),
    { now: () => 1000 },
  );
  observer.observe({
    foreground: true,
    available: true,
    panelOccluded: false,
    capturedAt: 1000,
    width: 1000,
    height: 1000,
    cardLayout: 'stacked-title-regions',
    titleLines: [
      { text: '精密发调', x: 300, y: 350, slot: 0 },
      { text: '循环引擎', x: 500, y: 350, slot: 1 },
      { text: '守护天使', x: 700, y: 350, slot: 2 },
    ],
  });
  const offer = emitted.find(event => event.kind === 'augment_offer');
  assert.ok(offer, '应该识别出三选一');
  assert.deepEqual(offer.options.map(option => option.name), ['精密发条', '循环引擎', '守护天使']);
});

test('两个候选都只差一个字时不猜，保持缺卡', () => {
  const emitted = [];
  const observer = createAugmentObserver(
    ['精密发条', '精密发条二', '循环引擎'],
    event => emitted.push(event),
    { now: () => 1000 },
  );
  observer.observe({
    foreground: true,
    available: true,
    panelOccluded: false,
    capturedAt: 1000,
    width: 1000,
    height: 1000,
    titleLines: [
      { text: '循环引擎', x: 500, y: 350, slot: 1 },
      { text: '守护天使', x: 700, y: 350, slot: 2 },
    ],
  });
  assert.equal(emitted.some(event => event.kind === 'augment_offer'), false);
});
