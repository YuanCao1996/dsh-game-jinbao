import test from 'node:test';
import assert from 'node:assert/strict';
import {initialOverlayState, applyOverlayEvent, overlayView} from '../overlay-state.mjs';
import {equipmentContext} from '../equipment-context.mjs';

function stateWithEnemies() {
  const state = initialOverlayState();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'game_start', t: 1,
    me: {champion: '青钢影', items: [{name: '三相之力', id: 3078}]},
    allies: [{champion: '青钢影'}],
    enemies: [
      {champion: '克格莫', items: [{name: '破败王者之刃', id: 3153}]},
      {champion: '锐雯', items: []},
    ],
  }, 'enemy-match');
  state.augmentSelections = [
    {side: 'enemy', hero: '克格莫', augment: '风暴狂涌', source: 'chat', confirmed: true, effect: '范围引爆'},
  ];
  return state;
}

test('装备事实同时包含敌方英雄定位、技能、成装和已记录海克斯', () => {
  const facts = equipmentContext(stateWithEnemies());
  assert.equal(facts.enemies[0].hero, '克格莫');
  assert.ok(facts.enemies[0].roles.includes('Marksman'), 'enemy roles must be present');
  assert.ok(facts.enemies[0].skills.length >= 2, 'enemy skill descriptions must be present');
  assert.ok(facts.enemies[0].skills.some((skill) => /腐蚀唾液|生化弹幕/.test(skill.name)));
  assert.equal(facts.enemies[0].items[0].name, '破败王者之刃');
  assert.deepEqual(facts.enemyAugments.map((row) => row.augment), ['风暴狂涌']);
  assert.ok(facts.self.roles.length, 'self role must be present');
  assert.ok(facts.self.skills.length, 'self skill description must be present');
});

test('敌人没有海克斯记录时明确为空，不编造', () => {
  const state = stateWithEnemies();
  state.augmentSelections = [];
  const facts = equipmentContext(state);
  assert.deepEqual(facts.enemyAugments, []);
  assert.deepEqual(facts.enemies[0].augments, []);
});

test('装备播报文字不被六件顺序污染，图标使用六件顺序', () => {
  const state = stateWithEnemies();
  applyOverlayEvent(state, {
    game: 'lol', match: state.match, t: 2, kind: 'broadcast', key: 'purchase',
    broadcast: '破败王者之刃搭配你的强化，能针对敌方克格莫的持续输出。',
    equipmentPlan: '六件顺序：三相之力、水银之靴、死亡之舞、斯特拉克的挑战护手、守护天使、兰顿之兆',
  }, 'enemy-match');
  const view = overlayView(state, {rows: []});
  assert.deepEqual(view.recommendedItemRows.map((row) => row.name).slice(0, 6), ['三相之力', '水银之靴', '死亡之舞', '斯特拉克的挑战护手', '守护天使', '兰顿之兆']);
  assert.equal(state.broadcasts.at(-1).text, '破败王者之刃搭配你的强化，能针对敌方克格莫的持续输出。');
});
