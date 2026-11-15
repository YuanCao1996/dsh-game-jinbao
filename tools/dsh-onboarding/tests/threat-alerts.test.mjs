import test from 'node:test';
import assert from 'node:assert/strict';
import { threatAlerts } from '../progress-events.mjs';

test('水银之靴不再被当成水银饰带', () => {
  const state = { at: Date.now(), broadcasts: [] };
  assert.deepEqual(threatAlerts(state, '敌人', ['水银之靴']), [], '魔抗鞋不是解控装，不该播报');
  const [line] = threatAlerts(state, '敌人', ['水银饰带']);
  assert.match(line, /水银饰带/);
  assert.ok(!/出了水银，/.test(line), '名字要写全：' + line);
});

test('其他关键成装仍然播报', () => {
  const state = { at: Date.now(), broadcasts: [] };
  assert.match(threatAlerts(state, '敌人', ['中娅沙漏'])[0], /中娅/);
  assert.match(threatAlerts(state, '敌人', ['无尽之刃'])[0], /爆发/);
});
