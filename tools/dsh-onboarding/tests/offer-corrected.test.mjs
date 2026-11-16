import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlayEvent, initialOverlayState } from '../overlay-state.mjs';

const offer = (roll, names, match = 'm1') => ({ kind: 'augment_offer', game: 'lol', match, t: 100 + roll, roll, options: names.map((name, slot) => ({ name, slot })) });

test('云端纠正卡名：同轮只替换候选名字，不重置轮次与历史', () => {
  let state = initialOverlayState();
  applyOverlayEvent(state, { kind: 'game_start', match: 'm1', game: 'lol' }, 'overlay-state.json');
  applyOverlayEvent(state, offer(2, ['钢化你心', '闪现向前', '威能之追求'], 'm1'), 'overlay-state.json');
  assert.equal(state.offerRound, 2);
  const history = state.offerHistory.slice();
  applyOverlayEvent(state, { kind: 'augment_offer_corrected', game: 'lol', match: 'm1', t: 111, roll: 2, options: [
    { name: '钢化你心', slot: 0 }, { name: '闪现向前', slot: 1 }, { name: '扳机炼狱', slot: 2 },
  ] }, 'overlay-state.json');
  assert.equal(state.offerRound, 2, '不是新一轮');
  assert.deepEqual(state.offers.map((row) => row.name), ['钢化你心', '闪现向前', '扳机炼狱']);
  assert.ok(state.offerHistory.includes('扳机炼狱'));
  assert.deepEqual(state.offerHistory.slice(0, history.length), history, '历史保留');
});

test('轮次对不上的纠正直接丢弃，避免污染当前面板', () => {
  let state = initialOverlayState();
  applyOverlayEvent(state, { kind: 'game_start', match: 'm2', game: 'lol' }, 'overlay-state.json');
  applyOverlayEvent(state, offer(3, ['甲', '乙', '丙'], 'm2'), 'overlay-state.json');
  applyOverlayEvent(state, { kind: 'augment_offer_corrected', game: 'lol', match: 'm2', t: 222, roll: 1, options: [{ name: '丁', slot: 0 }] }, 'overlay-state.json');
  assert.deepEqual(state.offers.map((row) => row.name), ['甲', '乙', '丙']);
});
