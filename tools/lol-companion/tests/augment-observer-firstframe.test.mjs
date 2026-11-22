import test from 'node:test';
import assert from 'node:assert/strict';
import { createAugmentObserver } from '../augment-observer.mjs';

test('开局三选一只有一帧时，三个槽位都读到卡名也立即发布', () => {
  const emitted = [];
  const observer = createAugmentObserver(
    ['科学狂人', '最终形态', '飞升仪式'],
    event => emitted.push(event),
    { now: () => 1000 },
  );
  observer.observe({
    foreground: true,
    available: true,
    panelOccluded: false,
    capturedAt: 1000,
    width: 1920,
    height: 1080,
    method: 'card-strip-fast',
    titleLines: [
      { text: '科学狂人', x: 550, y: 434, slot: 0 },
      { text: '最终形态', x: 917, y: 434, slot: 1 },
      { text: '飞升仪式', x: 1285, y: 434, slot: 2 },
    ],
  });
  const offer = emitted.find(event => event.kind === 'augment_offer');
  assert.ok(offer, '首帧应直接发出三选一');
  assert.deepEqual(offer.options.map(option => option.name), ['科学狂人', '最终形态', '飞升仪式']);
});

test('卡条只读到两张时也首帧发布，缺卡槽留给后续帧补', () => {
  const emitted = [];
  const observer = createAugmentObserver(
    ['科学狂人', '最终形态', '飞升仪式'],
    event => emitted.push(event),
    { now: () => 1000 },
  );
  observer.observe({
    foreground: true,
    available: true,
    panelOccluded: false,
    capturedAt: 1000,
    width: 1920,
    height: 1080,
    method: 'card-strip-fast',
    titleLines: [
      { text: '科学狂人', x: 550, y: 434, slot: 0 },
      { text: '最终形态', x: 917, y: 434, slot: 1 },
    ],
  });
  const offer = emitted.find(event => event.kind === 'augment_offer');
  assert.ok(offer, '两张精确卡名也应首帧发布');
  assert.deepEqual(offer.options.map(option => option.name), ['科学狂人', '最终形态']);
  assert.deepEqual(offer.missingSlots, [2]);
});