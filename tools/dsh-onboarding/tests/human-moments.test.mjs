import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleHumanMoments, resetHumanMoments, MOMENT_ROLES, DEATH_MIN_GAP_MS, DEATH_MAX_PER_MATCH } from '../human-moments.mjs';

// 昨晚实测：23/22/29 分钟的对局各只有 4/5/4 条播报，全是出装建议；
// 38 次阵亡零反馈，最长沉默 16.6 分钟。这一层补的就是"每局必有几句人话"。

const base = (patch = {}) => ({
  match: 'm#1',
  gameSeconds: 0,
  me: { dead: false },
  broadcasts: [],
  ...patch,
});

const lastText = state => state.broadcasts.at(-1)?.text ?? '';

test('四种人设都有开局/阵亡/结束/沉默台词', () => {
  for (const role of MOMENT_ROLES) {
    for (const cue of ['opening', 'death', 'endWin', 'endLoss', 'idle']) {
      const state = base();
      let ok = false;
      const now = Date.now();
      if (cue === 'opening') { state.gameSeconds = 10; ok = settleHumanMoments(state, now, { role, clock: 10 }); }
      if (cue === 'death') { state.me.dead = true; state.broadcasts = [{ at: now - 60_000, text: '上一句' }]; ok = settleHumanMoments(state, now, { role, clock: 20 }); }
      if (cue === 'endWin') { ok = settleHumanMoments(state, now, { role, clock: 1200, ended: true, win: true }); }
      if (cue === 'endLoss') { ok = settleHumanMoments(state, now, { role, clock: 1200, ended: true, win: false }); }
      if (cue === 'idle') {
        state.gameSeconds = 600;
        state.broadcasts = [{ at: now - 9 * 60_000, text: '很久以前' }];
        state.humanMoments = { match: 'm#1', emitted: { opening: true }, deaths: 0, lastDeathAt: 0, lastAt: now - 9 * 60_000 };
        ok = settleHumanMoments(state, now, { role, clock: 600 });
      }
      assert.ok(ok, `${role} 缺少 ${cue} 台词`);
      assert.ok(lastText(state).length <= 30, `${role}/${cue} 台词过长: ${lastText(state)}`);
    }
  }
});

test('开局问候：进对局 3 秒后才说，且一局只有一次', () => {
  const state = base({ gameSeconds: 1 });
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 1 }), false, '加载中不问候');
  state.gameSeconds = 5;
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 5 }), true);
  assert.equal(settleHumanMoments(state, Date.now() + 1000, { role: 'jinbao', clock: 6 }), false, '只问一次');
});

test('第一次阵亡不播报，其余仍受次数上限与间隔限制', () => {
  const state = base();
  const now = Date.now();
  state.gameSeconds = 60;
  state.humanMoments = { match: 'm#1', emitted: { opening: true }, deaths: 0, lastDeathAt: 0, lastAt: now - 60_000 };
  state.broadcasts = [{ at: now - 60_000, text: '开局了' }];

  let count = 0;
  for (let i = 0; i < 6; i += 1) {
    state.me.dead = true;
    const at = now + i * (DEATH_MIN_GAP_MS + 1000);
    if (settleHumanMoments(state, at, { role: 'jinbao', clock: 60 + i })) count += 1;
    state.me.dead = false;              // 复活
    settleHumanMoments(state, at + 500, { role: 'jinbao', clock: 61 + i });
  }
  assert.equal(count, DEATH_MAX_PER_MATCH - 1, '第一次阵亡不说，剩下最多反应 2 次，实际 ' + count);
});

test('最近有战术播报时不插话', () => {
  const state = base({ gameSeconds: 60 });
  state.broadcasts = [{ at: Date.now() - 3000, text: '下一件先做负极斗篷' }];
  state.me.dead = true;
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 60 }), false);
});

test('结束语按胜负选措辞，且优先于阵亡与沉默', () => {
  const winState = base({ gameSeconds: 1200, me: { dead: true } });
  assert.equal(settleHumanMoments(winState, Date.now(), { role: 'jinbao', clock: 1200, ended: true, win: true }), true);
  const winText = lastText(winState);
  assert.ok(/赢|拿下|稳/.test(winText), '胜利结束语措辞不对: ' + winText);

  const lossState = base({ gameSeconds: 1200 });
  assert.equal(settleHumanMoments(lossState, Date.now(), { role: 'jinbao', clock: 1200, ended: true, win: false }), true);
  assert.ok(/输|没拿下|没赢/.test(lastText(lossState)), '失败结束语措辞不对: ' + lastText(lossState));
});

test('长时间沉默：8 分钟没说话才补一句，且只补一次', () => {
  const now = Date.now();
  const state = base({ gameSeconds: 900 });
  state.humanMoments = { match: 'm#1', emitted: { opening: true }, deaths: 0, lastDeathAt: 0, lastAt: now - 5 * 60_000 };
  state.broadcasts = [{ at: now - 5 * 60_000, text: '五分钟前' }];
  assert.equal(settleHumanMoments(state, now, { role: 'jinbao', clock: 900 }), false, '才 5 分钟不该插话');

  state.humanMoments.lastAt = now - 9 * 60_000;
  assert.equal(settleHumanMoments(state, now, { role: 'jinbao', clock: 900 }), true);
  state.humanMoments.lastAt = now - 9 * 60_000;
  assert.equal(settleHumanMoments(state, now + 1000, { role: 'jinbao', clock: 901 }), false, '一局只补一次');
});

test('换对局后记忆重置', () => {
  const state = base({ match: 'm#1', gameSeconds: 30 });
  settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 10 });
  state.match = 'm#2';
  state.gameSeconds = 5;
  assert.equal(settleHumanMoments(state, Date.now(), { role: 'jinbao', clock: 5 }), true, '新对局应重新问好');
  resetHumanMoments(state);
  assert.equal(state.humanMoments.match, 'm#2');
  assert.deepEqual(state.humanMoments.emitted, {});
});

test('jinbao 的台词 51 句，且全部带着事实槽位或短语气口', async () => {
  const mod = await import('../human-moments.mjs');
  const text = await (await import('node:fs/promises')).readFile(new URL('../human-moments.mjs', import.meta.url), 'utf8');
  const block = text.slice(text.indexOf('  jinbao: {'), text.indexOf('  liurufeng: {'));
  const lines = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.equal(lines.length, 51, 'jinbao 应为 51 句（人味 36 + 触发句 15），实际 ' + lines.length);
  const sample = { champion: '安妮', level: 8, opponent: '劫', minute: 10, kills: 3, deaths: 2, n: 4, ally: '锐雯' };
  for (const line of lines) {
    // 带槽位的按“填进真实值之后”的长度算，模板本身的字符数没有意义
    const rendered = line.includes('{') ? mod.renderMoment(line, sample) : line;
    assert.ok(rendered, '槽位未填: ' + line);
    // 原有六类保持短句（≤14 字）；触发句要带次数/名字/英雄，放宽到 26 字。
    const limit = /\{(n|ally)\}/.test(line) ? 26 : 14;
    assert.ok(rendered.length <= limit, '过长: ' + rendered + ' (' + rendered.length + '字)');
    assert.ok(!/[。？]$/.test(line), '不要句号或问号结尾: ' + line);
  }
  assert.ok(lines.some(l => l.includes('{champion}')), '缺少英雄槽位');
  assert.ok(lines.some(l => l.includes('{level}')), '缺少等级槽位');
  assert.ok(lines.some(l => l.includes('{opponent}')), '缺少对手槽位');
  assert.ok(lines.some(l => l.includes('{minute}')), '缺少分钟槽位');
  assert.ok(lines.some(l => l.includes('{kills}')), '缺少人头槽位');
  assert.equal(typeof mod.renderMoment, 'function');
  const excited = lines.filter(l => l.includes('！')).length;
  assert.ok(excited >= 12, '活力不足：带感叹号的句子只有 ' + excited + ' 句');
});

test('事实槽位：有值就替换，缺值就放弃这句而不是硬编', async () => {
  const { renderMoment, momentFacts } = await import('../human-moments.mjs');
  const facts = momentFacts({ match: 'm', gameSeconds: 600, me: { level: 8, k: 3 }, enemies: [{ champion: '锐雯' }] });
  assert.equal(renderMoment('{level}级被抓，亏一点', facts), '8级被抓，亏一点');
  assert.equal(renderMoment('又是{opponent}？记住他', facts), '又是锐雯？记住他');
  assert.equal(renderMoment('{minute}分钟了，稳住', facts), '10分钟了，稳住');
  assert.equal(renderMoment('拿下！{kills}个人头呢', facts), '拿下！3个人头呢');
  assert.equal(renderMoment('又是{opponent}？记住他', momentFacts({ match: 'm', me: {} })), '', '缺事实时返回空串');
});

test('同一局内不重复同一句，用尽后才会重来', async () => {
  const { settleHumanMoments, resetHumanMoments } = await import('../human-moments.mjs');
  const state = { match: 'm#1', gameSeconds: 30, me: { dead: false, level: 5 }, enemies: [{ champion: '劫' }], broadcasts: [] };
  const seen = [];
  let now = Date.now();
  // 反复阵亡：每次间隔足够，且每次先复活
  for (let i = 0; i < 3; i += 1) {
    state.me.dead = true;
    if (settleHumanMoments(state, now, { role: 'jinbao', clock: state.gameSeconds })) seen.push(state.broadcasts.at(-1).text);
    state.me.dead = false;
    now += 60_000; state.gameSeconds += 60;
    settleHumanMoments(state, now, { role: 'jinbao', clock: state.gameSeconds });
    now += 1000;
  }
  const deathLines = seen.filter(Boolean);
  assert.equal(new Set(deathLines).size, deathLines.length, '阵亡台词重复了: ' + JSON.stringify(deathLines));
  resetHumanMoments(state);
});

test('叹词按场景出现：失误用哎呦/啊这，好事用哇塞/嘿嘿/嘻嘻，且每句最多一个', async () => {
  const fs = await import('node:fs/promises');
  const text = await fs.readFile(new URL('../human-moments.mjs', import.meta.url), 'utf8');
  const block = text.slice(text.indexOf('  jinbao: {'), text.indexOf('  liurufeng: {'));
  const INTERJ = ['哎呦', '啊哈', '嘿嘿', '嘻嘻', '哇塞', '天呐', '啊这', '哎呀'];
  const lines = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const withInterj = lines.filter(l => INTERJ.some(w => l.includes(w)));
  assert.ok(withInterj.length >= 5, '叹词太少: ' + withInterj.length);
  for (const line of withInterj) {
    const hits = INTERJ.filter(w => line.includes(w)).length;
    assert.equal(hits, 1, '一句里堆了多个叹词: ' + line);
  }
  // 失误/失利场景要有叹词，避免所有语气都靠感叹号
  const setback = lines.filter(l => /倒了|输了|丧气|怪/.test(l));
  assert.ok(setback.some(l => ['哎呦', '啊这', '天呐', '哎呀'].some(w => l.includes(w))), '失误场景缺少叹词');
  // 好消息场景要有偷笑/惊叹
  const good = lines.filter(l => /赢|拿下|上分/.test(l));
  assert.ok(good.some(l => ['哇塞', '嘿嘿', '嘻嘻'].some(w => l.includes(w))), '好消息场景缺少叹词');
});
