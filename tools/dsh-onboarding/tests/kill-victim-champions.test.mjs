import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOverlayState, applyOverlayEvent } from '../overlay-state.mjs';

test('多杀播报的击杀对象用英雄名，而不是召唤师名', () => {
  const state = initialOverlayState();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'game_start', t: 100,
    me: { champion: '安妮', name: 'Me' },
    enemies: [
      { name: 'EnemyOne', champion: '盖伦' },
      { name: 'EnemyTwo', champion: '拉克丝' },
      { name: 'EnemyThree', champion: '赵信' },
    ],
    allies: [],
  }, 'm');
  applyOverlayEvent(state, { game: 'lol', kind: 'event', t: 1000, name: 'ChampionKill', killer: 'Me', victim: 'EnemyOne' }, 'm');
  applyOverlayEvent(state, { game: 'lol', kind: 'event', t: 2000, name: 'ChampionKill', killer: 'Me', victim: 'EnemyTwo' }, 'm');
  applyOverlayEvent(state, { game: 'lol', kind: 'event', t: 3000, name: 'Multikill', killer: 'Me', KillStreak: 3, EventID: 30 }, 'm');
  const chain = state.praiseChains?.self;
  assert.ok(chain, '应该产生自己的多杀链');
  assert.deepEqual(chain.victims, ['盖伦', '拉克丝']);
});

test('认不出召唤师对应英雄时保留原名，不瞎编', () => {
  const state = initialOverlayState();
  applyOverlayEvent(state, {
    game: 'lol', kind: 'game_start', t: 100,
    me: { champion: '安妮', name: 'Me' },
    enemies: [{ name: 'EnemyOne', champion: '盖伦' }],
    allies: [],
  }, 'm');
  applyOverlayEvent(state, { game: 'lol', kind: 'event', t: 1000, name: 'ChampionKill', killer: 'Me', victim: 'EnemyOne' }, 'm');
  applyOverlayEvent(state, { game: 'lol', kind: 'event', t: 1100, name: 'ChampionKill', killer: 'Me', victim: ' stranger#1234 ' }, 'm');
  applyOverlayEvent(state, { game: 'lol', kind: 'event', t: 3000, name: 'Multikill', killer: 'Me', KillStreak: 3, EventID: 30 }, 'm');
  const chain = state.praiseChains?.self;
  assert.ok(chain, '应该产生自己的多杀链');
  assert.deepEqual(chain.victims, ['盖伦', 'stranger']);
});
