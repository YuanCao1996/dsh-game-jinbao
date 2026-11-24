import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAramSnapshot, preloadAramSnapshot, ARAM_SNAPSHOT_FILE, ARAM_SNAPSHOT_TTL_MS} from '../aram-snapshot.mjs';

const row = (name, title, winRate) => ({name, title, winRate, tier: 2, rank: 1, _type: 'champions'});

async function dirWith(rows, at = Date.now()) {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-aram-snapshot-'));
  await writeFile(join(dir, ARAM_SNAPSHOT_FILE), JSON.stringify({at, rows}));
  return dir;
}

test('snapshot lookup matches title, local name and english alias', async () => {
  const dir = await dirWith([{...row('安蓓萨', '铁血狼母', 53.55), en: 'Ambessa', alias: '狼母'}]);
  const snapshot = createAramSnapshot({stateDir: dir});
  assert.equal(snapshot.lookup('铁血狼母')?.winRate, 53.55, 'LCU gives the title');
  assert.equal(snapshot.lookup('安蓓萨')?.winRate, 53.55, 'local name also works');
  assert.equal(snapshot.lookup('ambessa')?.winRate, 53.55, 'english alias is normalized');
  assert.equal(snapshot.lookup('狼母')?.winRate, 53.55, 'player nickname alias is indexed');
  assert.equal(snapshot.lookup('盖伦'), null);
  assert.equal(snapshot.fresh(), true);
  await rm(dir, {recursive: true, force: true});
});

test('stale snapshots are reported as not fresh but still usable', async () => {
  const dir = await dirWith([row('安蓓萨', '铁血狼母', 53.55)], Date.now() - ARAM_SNAPSHOT_TTL_MS - 1000);
  const snapshot = createAramSnapshot({stateDir: dir});
  assert.equal(snapshot.fresh(), false);
  assert.equal(snapshot.lookup('铁血狼母')?.winRate, 53.55);
  await rm(dir, {recursive: true, force: true});
});

test('preload fills every champion, persists the snapshot and keeps updating memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-aram-preload-'));
  const snapshot = createAramSnapshot({stateDir: dir});
  const calls = [];
  const local = {'铁血狼母': ['安蓓萨', 53.55], '岩雀': ['塔莉垭', 52.1], '暗夜猎手': ['薇恩', 50.14]};
  const result = await preloadAramSnapshot({
    snapshot,
    champions: Object.keys(local),
    search: async (query) => {
      calls.push(query.query);
      const [name, winRate] = local[query.query];
      return {results: [{data: row(name, query.query, winRate)}]};
    },
  });
  assert.equal(result.failed, 0);
  assert.equal(result.added, 3);
  assert.equal(calls.length, 3);
  assert.equal(snapshot.lookup('铁血狼母')?.winRate, 53.55);
  const saved = JSON.parse(await readFile(join(dir, ARAM_SNAPSHOT_FILE), 'utf8'));
  assert.ok(saved.at > 0, 'persisted snapshot must carry a timestamp');
  assert.equal(saved.rows.length, 3);
  // 新创建的实例（相当于重启应用）直接读盘，不再请求。
  const reopened = createAramSnapshot({stateDir: dir});
  assert.equal(reopened.size, 3);
  assert.equal(reopened.lookup('铁血狼母')?.winRate, 53.55);
  await rm(dir, {recursive: true, force: true});
});

test('preload records misses and stops immediately on 429 without wiping old rows', async () => {
  const dir = await dirWith([row('安蓓萨', '铁血狼母', 53.55)]);
  const snapshot = createAramSnapshot({stateDir: dir});
  const result = await preloadAramSnapshot({
    snapshot,
    champions: ['岩雀', '暗夜猎手', '爆破鬼才'],
    search: async (query) => {
      if (query.query === '暗夜猎手') throw Object.assign(Error('quota'), {status: 429});
      return {results: []};
    },
  });
  assert.equal(result.failed, 429);
  assert.deepEqual(result.missed, ['岩雀', '暗夜猎手']);
  assert.equal(snapshot.lookup('铁血狼母')?.winRate, 53.55, 'previous rows must survive a failed refresh');
  await rm(dir, {recursive: true, force: true});
});

test('remember adds fallback rows in memory without touching the persisted timestamp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-aram-remember-'));
  const snapshot = createAramSnapshot({stateDir: dir});
  snapshot.save(1234);
  snapshot.remember('迅捷斥候', row('提莫', '迅捷斥候', 54.45));
  assert.equal(snapshot.lookup('迅捷斥候')?.winRate, 54.45);
  assert.equal(snapshot.at, 1234, 'remember must not mark the file as freshly preloaded');
  assert.equal(snapshot.lookup('提莫')?.winRate, 54.45);
  await rm(dir, {recursive: true, force: true});
});
