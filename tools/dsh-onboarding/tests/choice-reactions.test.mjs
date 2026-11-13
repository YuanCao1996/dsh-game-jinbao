import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceReaction, recordChoice, settleChoiceReactions, resetChoiceReactions, CHOICE_ROLES } from '../choice-reactions.mjs';

// 玩家做完选择要立刻有人味反馈：听劝就夸，不听就调侃，且跟着所选导师换语气。

function stateWith(adviceText, at = Date.now() - 1000) {
  return {
    broadcasts: adviceText ? [{ at, text: adviceText, priority: 1 }] : [],
    pendingChoices: [],
    choiceStreak: { agree: 0, disagree: 0 },
  };
}

test('四种人设各有自己的句子，且同结果不同文案', () => {
  const seen = new Set();
  for (const role of CHOICE_ROLES) {
    const agree = choiceReaction({ role, kind: 'item', agreed: true, pick: 0, name: '心之钢' });
    const disagree = choiceReaction({ role, kind: 'item', agreed: false, pick: 0, name: '心之钢' });
    assert.ok(agree.length > 0, role + ' 需要肯定文案');
    assert.ok(disagree.length > 0, role + ' 需要调侃文案');
    assert.ok(agree.length <= 30, role + ' 肯定文案要短: ' + agree);
    assert.ok(disagree.length <= 30, role + ' 调侃文案要短: ' + disagree);
    seen.add(agree);
  }
  assert.ok(seen.size >= 3, '四种人设不能说着几乎一样的话');
});

test('听了推荐 → 肯定；没听 → 调侃', () => {
  const agreeState = stateWith('下一件优先做心之钢，攒钱买巨人腰带。');
  recordChoice(agreeState, { kind: 'item', name: '心之钢', at: Date.now() - 500 });
  assert.equal(settleChoiceReactions(agreeState, Date.now(), { role: 'jinbao' }), true);
  const agreed = agreeState.broadcasts.at(-1);
  assert.equal(agreed.agreed, true);
  assert.equal(agreed.praise, true, '走语音的 praise 通道，才能即时出声');
  assert.equal(agreed.choiceKind, 'item');

  const disagreeState = stateWith('下一件优先做心之钢，攒钱买巨人腰带。');
  recordChoice(disagreeState, { kind: 'item', name: '破败王者之刃', at: Date.now() - 500 });
  assert.equal(settleChoiceReactions(disagreeState, Date.now(), { role: 'jinbao' }), true);
  assert.equal(disagreeState.broadcasts.at(-1).agreed, false);
});

test('没有可比的建议时保持安静', () => {
  const state = stateWith('');
  recordChoice(state, { kind: 'item', name: '心之钢', at: Date.now() - 500 });
  assert.equal(settleChoiceReactions(state, Date.now(), { role: 'jinbao' }), false);
  assert.equal(state.broadcasts.length, 0);
});

test('只有出装/强化类播报才参与判断', () => {
  const state = stateWith('稳住节奏，别单独追人。', Date.now() - 1000);
  recordChoice(state, { kind: 'item', name: '心之钢', at: Date.now() - 500 });
  assert.equal(settleChoiceReactions(state, Date.now(), { role: 'jinbao' }), false, '普通建议不当作推荐依据');
});

test('连续不听话会升级语气', () => {
  const state = stateWith('下一件优先做心之钢。');
  const first = [];
  for (let i = 0; i < 3; i += 1) {
    recordChoice(state, { kind: 'item', name: '破败王者之刃' + i, at: Date.now() - 500 });
    settleChoiceReactions(state, Date.now(), { role: 'wangbatian' });
    first.push(state.broadcasts.at(-1).text);
  }
  assert.ok(first[0] !== first[2], '第三次的措辞应该更重：' + JSON.stringify(first));
});

test('过期选择不再补话，避免马后炮', () => {
  const state = stateWith('下一件优先做心之钢。');
  const stale = Date.now() - 60_000;
  recordChoice(state, { kind: 'item', name: '心之钢', at: stale });
  assert.equal(settleChoiceReactions(state, Date.now(), { role: 'jinbao' }), false);
});

test('同一件装备重复读取不会重复播', () => {
  const state = stateWith('下一件优先做心之钢。');
  const at = Date.now() - 300;
  recordChoice(state, { kind: 'item', name: '心之钢', at });
  recordChoice(state, { kind: 'item', name: '心之钢', at: at + 100 });
  assert.equal(state.pendingChoices.length, 1, '20 秒内的同名选择只记一次');
});

test('重置后清空待处理与连击计数', () => {
  const state = stateWith('下一件优先做心之钢。');
  recordChoice(state, { kind: 'item', name: '心之钢' });
  state.choiceStreak.disagree = 3;
  resetChoiceReactions(state);
  assert.equal(state.pendingChoices.length, 0);
  assert.deepEqual(state.choiceStreak, { agree: 0, disagree: 0 });
});
