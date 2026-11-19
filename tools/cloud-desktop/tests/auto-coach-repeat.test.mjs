import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOverlayService } from '../../dsh-onboarding/overlay-state.mjs';
import { createGameMemory } from '../../dsh-coach-server/lib/game-memory.js';
import { createCloudCoach } from '../auto-coach.mjs';
import { adviceSimilarity } from '../advice-text.mjs';

const waitFor = async (check, label) => { for (let i = 0; i < 250; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('timed out: ' + label); };

test('同样的建议不会被播两遍，第二问会带上「刚才你已经说过」', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-repeat-'));
  let overlay, coach;
  try {
    await mkdir(join(dir, 'logs'));
    const file = join(dir, 'logs/lol-fixture.jsonl');
    const at = Date.now() - 100;
    await writeFile(file, JSON.stringify({ game: 'lol', match: 'one', kind: 'game_start', mode: 'KIWI', t: at, gameTime: 180,
      me: { champion: '安妮', level: 6, championAlias: 'Annie', items: [] }, allies: [], enemies: [] }) + '\n');
    overlay = await createOverlayService({ stateDir: dir, pollMs: 20, agentChat: async () => { throw Error('no equipment model'); }, search: async () => ({ results: [] }) });
    const memory = createGameMemory(dir);
    // 模型两次都吐出同一句话：第二次必须被拦住。
    const answer = '强化效果：珠光护手让技能可以暴击；打法：等队友开团后接提伯斯；下一件成装：下次可购买时做灭世者的死亡之帽。';
    const questions = [];
    coach = createCloudCoach({
      stateDir: dir, view: overlay.view, getContext: (game, match) => memory.currentFacts(game, match),
      trace: () => {},
      agent: { ask: async request => { questions.push(String(request.question ?? '')); return answer; } },
    });

    await appendFile(file, JSON.stringify({ game: 'lol', match: 'one', kind: 'augment_mutate', t: at + 200, gameTime: 200,
      augment: '珠光护手', champion: '安妮', who: 'self', source: 'log-confirmed', confidence: 'high' }) + '\n');
    await waitFor(() => overlay.view().advice.includes('珠光护手'), 'owned applied');
    await waitFor(async () => { await coach.tick(); return overlay.view().advice.includes('强化效果'); }, 'first advice');
    const broadcastFile = join(dir, 'logs/coach_broadcasts.jsonl');
    const countRows = async () => (await readFile(broadcastFile, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).length;
    const firstCount = await countRows();
    assert.ok(firstCount >= 1, '第一条建议应当被播出去');

    // 换一个海克斯再问一次；模型仍然回同一句。
    await appendFile(file, JSON.stringify({ game: 'lol', match: 'one', kind: 'augment_mutate', t: at + 400, gameTime: 260,
      augment: '巨人杀手', champion: '安妮', who: 'self', source: 'log-confirmed', confidence: 'high' }) + '\n');
    await waitFor(() => overlay.view().advice.includes('巨人杀手'), 'second augment applied');
    for (let i = 0; i < 6; i++) await coach.tick();

    const after = await countRows();
    assert.equal(after, firstCount, '几乎逐字重复的建议不应再播一次，实际广播数：' + after);
    const hinted = questions.some(q => q.includes('刚才你已经说过'));
    assert.ok(hinted, '第二次提问必须带上「刚才你已经说过」，实际提问：' + JSON.stringify(questions.slice(-1)));
  } finally { coach?.close(); await overlay?.close(); await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
});

test('相似度只拦逐字重复，不误伤换了说法的建议', () => {
  const a = '先用雪球贴脸，技能命中让蜜蜂炸开，小法要留雪球先手；跟祖安狂人往前压吧。';
  assert.ok(adviceSimilarity(a, a) === 1);
  assert.ok(adviceSimilarity(a, '先用雪球贴脸，技能命中让蜜蜂炸开，小法要留雪球先手；跟祖安狂人往前压吧！') >= 0.5, '只换标点算重复');
  const different = '这波先回城补装备，别在中路硬拼；下次开团等打野到再上。';
  assert.ok(adviceSimilarity(a, different) < 0.2, '换了内容的建议不能误伤：' + adviceSimilarity(a, different));
});
