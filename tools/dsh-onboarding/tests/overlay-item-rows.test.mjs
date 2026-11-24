import test from 'node:test';
import assert from 'node:assert/strict';
import {initialOverlayState, applyOverlayEvent, overlayView} from '../overlay-state.mjs';

function stateWithRoster() {
  const state = initialOverlayState();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'game_start', t: 1,
    me: {champion: '安妮'},
    allies: [{champion: '安妮'}],
    enemies: [{champion: '锐雯', items: []}],
  }, 'icon-match');
  return state;
}

test('recommended build exposes completed items only', () => {
  const state = stateWithRoster();
  const view = overlayView(state, {rows: [{
    _type: 'coreBuilds', champion: '安妮', winRate: 55, pickRate: 12, tier: 'T1',
    itemIds: '[3031,1001,3153]', items: '["无尽之刃","鞋子","破败王者之刃"]',
  }]});
  assert.deepEqual(view.recommendedItemRows.map((row) => row.id), ['3031', '3153'], '散件不进入推荐图标');
  assert.deepEqual(view.recommendedItemRows.map((row) => row.name), ['无尽之刃', '破败王者之刃']);
  assert.equal(view.selfItemRows, undefined, '本人当前装备不再出现在视图里');
  assert.equal(view.enemyKeyItemRows, undefined, '敌方装备改为事件内展示，不再有顶部行');
});

test('enemy equipment events keep hero and completed item ids for icons', () => {
  const state = stateWithRoster();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'state', t: 2,
    me: {champion: '安妮'},
    allies: [{champion: '安妮'}],
    enemies: [{champion: '锐雯', items: [{id: 3031, name: '无尽之刃'}]}],
  }, 'icon-match');
  const event = state.completedEquipmentEvents.at(-1);
  assert.ok(event, 'enemy completed item must produce an event');
  assert.deepEqual(event.itemRows, [{id: '3031', name: '无尽之刃', count: 1}]);
  const inventory = state.events.find((row) => row.kind === 'inventory');
  assert.ok(inventory?.equipment, 'the activity-line inventory event must carry structured equipment');
  assert.equal(inventory.equipment.hero, '锐雯');
  assert.deepEqual(inventory.equipment.items, [{id: '3031', name: '无尽之刃', count: 1}]);
  const alert = state.broadcasts.find((row) => /无尽之刃/.test(String(row.text ?? '')));
  assert.ok(alert?.equipment, 'enemy item alert must carry the hero and item for inline icons');
  assert.equal(alert.equipment.hero, '锐雯');
  assert.deepEqual(overlayView(state).thread.find((row) => row.equipment)?.equipment.items, [{id: '3031', name: '无尽之刃'}]);
});
