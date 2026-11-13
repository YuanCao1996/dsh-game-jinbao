import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLolCoachingPlan } from '../lib/lol-coaching-plan.js';

// 昨晚真机问题：同一局 3–4 分钟里连出 3–4 套互相矛盾的六件顺序
// （战争之影首件 朔极之矛/长剑/神圣分离者；虚空遁地兽首件 心之钢/熔渣/红水晶/自然之力）。
// 规则：本局已发过 opening 计划、且英雄与已选强化没变 → 这一回合静默。

const openingEvent = [{ kind: 'game_start', coachTrigger: 'opening', me: { champion: '赫卡里姆', level: 3 } }];

const baseCurrent = (patch = {}) => ({
  game: 'lol',
  match: 'm#1',
  phase: 'InProgress',
  gameSeconds: 200,
  me: { champion: '赫卡里姆', level: 3, items: [], dead: false },
  allies: [], enemies: [],
  ownedAugments: [],
  broadcasts: [],
  offers: [],
  events: [],
  ...patch,
});

test('没有历史计划时正常生成开局计划', () => {
  const plan = buildLolCoachingPlan(openingEvent, baseCurrent());
  assert.equal(plan.stage, 'opening');
  assert.equal(plan.skip, undefined);
  assert.ok(plan.prompt.includes('出装'));
});

test('已有开局计划且局面未变 → 本回合跳过', () => {
  const current = baseCurrent({
    broadcasts: [{
      at: Date.now() - 60_000,
      text: '开局六件顺序：朔极之矛 → 水银之靴 → 星蚀',
      validity: { stage: 'opening', dependencies: { champion: '赫卡里姆', owned: '[]' } },
    }],
  });
  const plan = buildLolCoachingPlan(openingEvent, current);
  assert.equal(plan.skip, 'opening-already-planned');
  assert.equal(plan.prompt, '');
});

test('已选强化变了 → 允许重新规划', () => {
  const current = baseCurrent({
    ownedAugments: ['钢化你心'],
    broadcasts: [{
      at: Date.now() - 60_000,
      text: '开局六件顺序：朔极之矛 → 水银之靴',
      validity: { stage: 'opening', dependencies: { champion: '赫卡里姆', owned: '[]' } },
    }],
  });
  const plan = buildLolCoachingPlan(openingEvent, current);
  assert.notEqual(plan.skip, 'opening-already-planned');
  assert.ok(plan.facts.priorOpeningPlan, 'facts 里要带上上一版计划');
  assert.ok(String(plan.facts.priorOpeningPlan.text).includes('朔极之矛'));
});

test('计划过期（超过 10 分钟）后允许重出', () => {
  const current = baseCurrent({
    broadcasts: [{
      at: Date.now() - 11 * 60 * 1000,
      text: '旧计划',
      validity: { stage: 'opening', dependencies: { champion: '赫卡里姆', owned: '[]' } },
    }],
  });
  const plan = buildLolCoachingPlan(openingEvent, current);
  assert.notEqual(plan.skip, 'opening-already-planned');
});

test('提示词要求不重复已购装备、改路线必须说明理由', () => {
  const plan = buildLolCoachingPlan(openingEvent, baseCurrent());
  assert.ok(plan.prompt.includes('facts.me.items'), '要引用已购装备字段');
  assert.ok(plan.prompt.includes('沿用它'), '要求沿用已有路线');
  assert.ok(plan.prompt.includes('为什么改'), '改路线要说明理由');
});
