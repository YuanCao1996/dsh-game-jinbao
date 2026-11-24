import test from 'node:test';
import assert from 'node:assert/strict';
import {initialOverlayState, applyOverlayEvent, overlayView} from '../overlay-state.mjs';

test('overlay view exposes structured self and enemy item rows for icons', () => {
  const state = initialOverlayState();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'game_start', t: 1,
    me: {champion: '安妮', items: [{id: 3031, name: '无尽之刃'}, {id: 1001, name: '鞋子'}]},
    allies: [{champion: '安妮'}],
    enemies: [{champion: '锐雯', items: []}],
  }, 'icon-match');
  state.completedEquipmentEvents = [{hero: '锐雯', items: ['无尽之刃'], itemRows: [{id: '3031', name: '无尽之刃'}]}];
  const view = overlayView(state);
  assert.deepEqual(view.selfItemRows.map((row) => row.id), ['3031'], 'components are not shown as completed items');
  assert.equal(view.selfItemRows[0].name, '无尽之刃');
  assert.deepEqual(view.enemyKeyItemRows.map((row) => [row.id, row.hero]), [['3031', '锐雯']]);
});

test('equipment observation keeps item ids so the icon route can resolve them', () => {
  const state = initialOverlayState();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'game_start', t: 1,
    me: {champion: '安妮'},
    allies: [{champion: '安妮'}],
    enemies: [{champion: '锐雯', items: []}],
  }, 'icon-match');
  applyOverlayEvent(state, {
    game: 'lol', kind: 'state', t: 2,
    me: {champion: '安妮'},
    allies: [{champion: '安妮'}],
    enemies: [{champion: '锐雯', items: [{id: 3031, name: '无尽之刃'}]}],
  }, 'icon-match');
  const event = state.completedEquipmentEvents.at(-1);
  assert.ok(event, 'enemy completed item must produce an event');
  assert.deepEqual(event.itemRows, [{id: '3031', name: '无尽之刃', count: 1}]);
  assert.deepEqual(overlayView(state).enemyKeyItemRows.map((row) => row.id), ['3031']);
});
