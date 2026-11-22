import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlayEvent, initialOverlayState, observeAllyActivity } from '../overlay-state.mjs';
import { settleExtraMoments } from '../human-moments.mjs';

// 触发型台词：连杀被终结 / 五杀被抢 / 队友挂机 / 首次上手 / 连胜。
// 从事件到出句整条链路都要覆盖——只测渲染函数会漏掉「事件条件写错」这类问题。

const me = { champion: '安妮', riotId: '我#1' };
const start = (state, t0, allies = []) => applyOverlayEvent(state, {
  game: 'lol', match: 'm1', t: t0, kind: 'game_start', me, allies,
}, 'm1');

test('连杀被终结：攒到 3 杀以上阵亡会出一句', () => {
  const state = initialOverlayState();
  const t0 = Date.now();
  start(state, t0);
  for (let i = 0; i < 4; i += 1) {
    applyOverlayEvent(state, { game: 'lol', match: 'm1', t: t0 + (i + 1) * 1000, kind: 'event', name: 'ChampionKill', id: i + 1, killer: '我#1', victim: '敌人' + i }, 'm1');
  }
  assert.equal(state.killStreak, 4, '自己的击杀要累计');
  applyOverlayEvent(state, { game: 'lol', match: 'm1', t: t0 + 9000, kind: 'event', name: 'ChampionKill', id: 99, killer: '敌人A', victim: '我#1' }, 'm1');
  settleExtraMoments(state, t0 + 10_000, { role: 'jinbao' });
  const line = (state.broadcasts ?? []).find(row => row.humanKind === 'streakEnded');
  assert.ok(line, '应当出一句「被终结」');
  assert.match(line.text, /4/);
  assert.equal(state.killStreak, 0, '阵亡后连杀清零');
});

test('2 杀阵亡不出声（不够格）', () => {
  const state = initialOverlayState();
  const t0 = Date.now();
  start(state, t0);
  for (let i = 0; i < 2; i += 1) {
    applyOverlayEvent(state, { game: 'lol', match: 'm1', t: t0 + (i + 1) * 1000, kind: 'event', name: 'ChampionKill', id: i + 1, killer: '我#1', victim: '敌人' + i }, 'm1');
  }
  applyOverlayEvent(state, { game: 'lol', match: 'm1', t: t0 + 5000, kind: 'event', name: 'ChampionKill', id: 90, killer: '敌人A', victim: '我#1' }, 'm1');
  settleExtraMoments(state, t0 + 6000, { role: 'jinbao' });
  assert.equal((state.broadcasts ?? []).filter(row => row.humanKind === 'streakEnded').length, 0);
});

test('五杀被抢：队友五杀而我已经 3 杀，会点名队友', () => {
  const state = initialOverlayState();
  const t0 = Date.now();
  start(state, t0, [{ champion: '锐雯', name: '队友#2', level: 8, cs: 90 }]);
  for (let i = 0; i < 3; i += 1) {
    applyOverlayEvent(state, { game: 'lol', match: 'm1', t: t0 + (i + 1) * 1000, kind: 'event', name: 'ChampionKill', id: i + 1, killer: '我#1', victim: '敌' + i }, 'm1');
  }
  applyOverlayEvent(state, { game: 'lol', match: 'm1', t: t0 + 6000, kind: 'event', name: 'Multikill', id: 50, KillStreak: 5, killer: '队友#2' }, 'm1');
  settleExtraMoments(state, t0 + 7000, { role: 'jinbao' });
  const line = (state.broadcasts ?? []).find(row => row.humanKind === 'pentaStolen');
  assert.ok(line);
  assert.match(line.text, /锐雯/);
});

test('队友挂机：等级和补刀 4 分钟没变才提醒', () => {
  const state = initialOverlayState();
  const t0 = Date.now();
  start(state, t0, [{ champion: '锐雯', name: '队友#2', level: 5, cs: 40 }]);
  observeAllyActivity(state, t0 + 1000);
  observeAllyActivity(state, t0 + 100_000);
  settleExtraMoments(state, t0 + 100_001, { role: 'jinbao' });
  assert.equal((state.broadcasts ?? []).filter(row => row.humanKind === 'allyAfk').length, 0, '不到 4 分钟不该说');

  observeAllyActivity(state, t0 + 300_000);
  settleExtraMoments(state, t0 + 300_001, { role: 'jinbao' });
  const line = (state.broadcasts ?? []).find(row => row.humanKind === 'allyAfk');
  assert.ok(line, '超过 4 分钟应当提醒');
  assert.match(line.text, /锐雯/);
});

test('首次上手与连胜：排队后按角色渲染', () => {
  const state = initialOverlayState();
  state.match = 'm9';
  state.game = 'lol';
  state.pendingMoments.push({ kind: 'firstChampion', key: 'first:m9', facts: { champion: '武器大师' } });
  state.pendingMoments.push({ kind: 'winStreak', key: 'win:m9', facts: { n: 3 } });
  settleExtraMoments(state, Date.now(), { role: 'tiezhi' });
  const texts = (state.broadcasts ?? []).map(row => row.text);
  assert.ok(texts.some(text => text.includes('武器大师')), '首次上手要带英雄名');
  assert.ok(texts.some(text => text.includes('3')), '连胜要带次数');
});

test('同一条触发不会重复播（humanKey 去重）', () => {
  const state = initialOverlayState();
  state.match = 'm1';
  state.pendingMoments.push({ kind: 'winStreak', key: 'win:m1', facts: { n: 4 } });
  settleExtraMoments(state, Date.now(), { role: 'jinbao' });
  const first = (state.broadcasts ?? []).filter(row => row.humanKind === 'winStreak').length;
  state.pendingMoments.push({ kind: 'winStreak', key: 'win:m1', facts: { n: 4 } });
  settleExtraMoments(state, Date.now() + 1000, { role: 'jinbao' });
  assert.equal((state.broadcasts ?? []).filter(row => row.humanKind === 'winStreak').length, first, '同一个 key 不能播两次');
});
