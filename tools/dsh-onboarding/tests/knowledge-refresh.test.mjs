import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,appendFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOverlayService} from '../overlay-state.mjs';

// A real match showed the augments page stuck on "正在查询英雄适配排名…" for the whole game
// while the retrieval endpoint answered fine from the same token. The refresh used to run
// only when a context key changed, and nothing recorded whether it had even started, so the
// failure was invisible. These pin the two things that make it observable and self-healing.

const waitFor = async (check, label) => {
  for (let i = 0; i < 150; i += 1) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('timed out: ' + label);
};

const AUGMENTS = [
  { name: '屹立不倒', champion: '虚空女皇 卑尔维斯', winRate: 58.65, tier: 'T1', rank: 1, _type: 'augments' },
  { name: '双刀流', champion: '虚空女皇 卑尔维斯', winRate: 58.14, tier: 'T1', rank: 2, _type: 'augments' },
];

async function serviceWith(search) {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-knowledge-'));
  await mkdir(join(dir, 'logs'));
  const service = await createOverlayService({
    stateDir: dir,
    pollMs: 20,
    search,
    agentChat: async () => { throw Object.assign(Error('no model'), { status: 503 }); },
  });
  const at = Date.now();
  await appendFile(join(dir, 'logs/lol-kn.jsonl'), JSON.stringify({
    game: 'lol', match: 'kn1', kind: 'state', t: at,
    me: { champion: '虚空女皇', championAlias: 'Belveth', level: 11, items: [] },
    allies: ['盖伦', '拉克丝', '赵信', '索拉卡'].map((champion) => ({ champion })),
    enemies: ['锐雯', '劫', '薇恩', '锤石', '阿狸'].map((champion) => ({ champion })),
  }) + '\n');
  return { dir, service };
}

test('a champion lookup fills the Top10 page and records the attempt', async () => {
  const { dir, service } = await serviceWith(async (query) => ({
    results: query.filter?._type === 'augments' ? AUGMENTS.map((data) => ({ data }))
      : query.dataset === 'aram-ranking' ? [{ data: { name: '卑尔维斯', title: '虚空女皇', winRate: 56.31, tier: 3 } }]
      : [],
  }));
  try {
    await waitFor(() => (service.view().augmentsRankingRows ?? []).some((row) => row.name === '屹立不倒') || /屹立不倒/.test(service.view().augments), 'Top10 rendered');
    const status = JSON.parse(await readFile(join(dir, 'knowledge-status.json'), 'utf8'));
    assert.equal(status.phase === 'started' && status.rows === 0, false, 'the finished record must replace the started one');
    assert.ok(status.rows >= 2, 'the finished record must report the rows it loaded: ' + JSON.stringify(status));
    assert.equal(status.champion, '虚空女皇');
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty lookup keeps retrying instead of waiting for a context change', async () => {
  let calls = 0;
  const { dir, service } = await serviceWith(async (query) => {
    if (query.filter?._type === 'augments') {
      calls += 1;
      // The first lookup answers empty, as a cache miss would; the page must not stay blank.
      return { results: calls >= 2 ? AUGMENTS.map((data) => ({ data })) : [] };
    }
    return { results: [] };
  });
  try {
    await waitFor(() => (service.view().augmentsRankingRows ?? []).some((row) => row.name === '屹立不倒') || /屹立不倒/.test(service.view().augments), 'Top10 rendered after a retry');
    assert.ok(calls >= 2, 'the lookup must be retried, saw ' + calls);
    const status = JSON.parse(await readFile(join(dir, 'knowledge-status.json'), 'utf8'));
    assert.ok(status.rows >= 1, 'the finished record must show the loaded rows');
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('roster win rates render progressively while the rest are still loading', async () => {
  // 实测玩家抱怨：进对局后「双方阵容」整列「—」要等所有英雄查完才一起出现。
  // 现在每查到一个英雄就先写进 knowledge/state，慢的那一个不该拖住已到的人。
  const { dir, service } = await serviceWith(async (query) => {
    if (query.dataset === 'aram-ranking') {
      await new Promise((r) => setTimeout(r, query.query === '阿狸' ? 900 : 10));
      return { results: [{ data: { name: query.query, title: query.query, winRate: 50, tier: 'T2' } }] };
    }
    return { results: query.filter?._type === 'augments' ? AUGMENTS.map((data) => ({ data })) : [] };
  });
  try {
    let firstRatedAt = 0, completeAt = 0;
    for (let i = 0; i < 300; i += 1) {
      const rated = service.view().playerRows.filter((row) => row.winRate != null).length;
      if (rated > 0 && !firstRatedAt) firstRatedAt = Date.now();
      if (rated >= 10) { completeAt = Date.now(); break; }
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(firstRatedAt, 'at least one win rate should appear');
    assert.ok(completeAt, 'all ten win rates should be loaded');
    assert.ok(completeAt - firstRatedAt >= 400, 'rows must be published as they arrive, not only after the slowest lookup: gap ' + (completeAt - firstRatedAt) + 'ms');
    assert.equal(service.view().playerRows.filter((row) => row.winRate != null).length, 10);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ten-player win rates come from the preloaded daily snapshot without a single retrieval call', async () => {
  // 服务器数据是每日快照：应用空闲时已整份拉好，对局里没有理由再按英雄检索。
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-snapshot-roster-'));
  await mkdir(join(dir, 'logs'));
  const champions = ['虚空女皇', '盖伦', '拉克丝', '赵信', '索拉卡', '锐雯', '劫', '薇恩', '锤石', '阿狸'];
  await writeFile(join(dir, 'aram-ranking-snapshot.json'), JSON.stringify({
    at: Date.now(),
    rows: champions.map((name, index) => ({name, title: name, winRate: 50 + index / 10, tier: 'T2', _type: 'champions'})),
  }));
  const at = Date.now();
  await appendFile(join(dir, 'logs/lol-live.jsonl'), JSON.stringify({
    game: 'lol', match: 'snap1', kind: 'state', t: at,
    me: {champion: '虚空女皇'},
    allies: ['虚空女皇', '盖伦', '拉克丝', '赵信', '索拉卡'].map((champion) => ({champion})),
    enemies: ['锐雯', '劫', '薇恩', '锤石', '阿狸'].map((champion) => ({champion})),
  }) + '\n');
  let aramCalls = 0;
  const service = await createOverlayService({
    stateDir: dir,
    pollMs: 20,
    search: async (query) => {
      if (query.dataset === 'aram-ranking') { aramCalls += 1; throw Object.assign(Error('must not fetch'), {status: 503}); }
      return {results: []};
    },
    agentChat: async () => { throw Object.assign(Error('no model'), {status: 503}); },
  });
  try {
    await waitFor(() => service.view().playerRows.length === 10 && service.view().playerRows.every((row) => row.winRate != null), 'snapshot roster');
    assert.equal(aramCalls, 0, 'roster rows must be served from the local snapshot');
    const rates = service.view().playerRows.map((row) => row.winRate).sort((a, b) => a - b);
    assert.deepEqual(rates, [50, 50.1, 50.2, 50.3, 50.4, 50.5, 50.6, 50.7, 50.8, 50.9]);
  } finally {
    await service.close();
    await rm(dir, {recursive: true, force: true});
  }
});

test('a failing lookup leaves a record that says why the page is empty', async () => {
  const { dir, service } = await serviceWith(async () => { throw Object.assign(Error('denied'), { status: 401 }); });
  try {
    await waitFor(async () => {
      try {
        const status = JSON.parse(await readFile(join(dir, 'knowledge-status.json'), 'utf8'));
        return status.phase !== 'started' && status.failed === true;
      } catch { return false; }
    }, 'failure recorded');
    const status = JSON.parse(await readFile(join(dir, 'knowledge-status.json'), 'utf8'));
    // 基础查询三条 + 每个已知英雄一条，全部失败时都应记为 401。
    assert.ok(status.errors.length >= 3, 'every failed lookup must be counted: ' + JSON.stringify(status.errors));
    assert.equal(status.errors.every((code) => code === 401), true, 'got ' + JSON.stringify(status.errors));
    assert.match(status.message, /授权|登录/);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
