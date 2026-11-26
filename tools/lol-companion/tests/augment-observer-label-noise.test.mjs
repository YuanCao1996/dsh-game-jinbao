import test from 'node:test';
import assert from 'node:assert/strict';
import {createAugmentObserver} from '../augment-observer.mjs';

test('两行标题「升级 / 风暴狂涌」按拼接名命中，不再报未收录', () => {
  const emitted = [];
  const observer = createAugmentObserver(
    ['升级：风暴狂涌', '有始有终', '无尽大杀四方'],
    (event) => emitted.push(event),
    {now: () => 1000},
  );
  observer.observe({
    foreground: true, available: true, panelOccluded: false,
    capturedAt: 1000, width: 1000, height: 1000,
    cardLayout: 'stacked-title-regions', method: 'card-strip-fast',
    titleLines: [
      {text: '升级', slot: 0, x: 300, y: 350},
      {text: '风暴狂涌', slot: 0, x: 362, y: 351},
      {text: '伤害', slot: 0, x: 360, y: 380},
      {text: '有始有终', slot: 1, x: 500, y: 350},
      {text: '伤害功能', slot: 1, x: 520, y: 380},
      {text: '无尽大杀四方', slot: 2, x: 700, y: 350},
      {text: '伤害', slot: 2, x: 720, y: 380},
    ],
    lines: [],
  });
  const offer = emitted.find((event) => event.kind === 'augment_offer');
  assert.ok(offer, '应该识别出三选一');
  assert.deepEqual(offer.options.map((option) => option.name), ['升级：风暴狂涌', '有始有终', '无尽大杀四方']);
  assert.equal(emitted.filter((event) => event.kind === 'augment_name_unknown').length, 0);
});

test('卡面标签残片不再当作未收录卡名', () => {
  const emitted = [];
  const observer = createAugmentObserver(
    ['最终形态', '小丑学院', '歌利亚巨人'],
    (event) => emitted.push(event),
    {now: () => 2000},
  );
  observer.observe({
    foreground: true, available: true, panelOccluded: false,
    capturedAt: 2000, width: 1000, height: 1000,
    cardLayout: 'stacked-title-regions', method: 'card-strip-fast',
    titleLines: [
      {text: '最终形态', slot: 0, x: 300, y: 350},
      {text: '复原力伤軎', slot: 0, x: 320, y: 382},
      {text: '小丑学院', slot: 1, x: 500, y: 350},
      {text: '己方伤害', slot: 1, x: 520, y: 382},
      {text: '歌利亚巨人', slot: 2, x: 700, y: 350},
      {text: '复原力伤', slot: 2, x: 720, y: 382},
    ],
    lines: [],
  });
  const offer = emitted.find((event) => event.kind === 'augment_offer');
  assert.ok(offer, '应该识别出三选一');
  assert.deepEqual(offer.options.map((option) => option.name), ['最终形态', '小丑学院', '歌利亚巨人']);
  assert.equal(emitted.filter((event) => event.kind === 'augment_name_unknown').length, 0);
});
