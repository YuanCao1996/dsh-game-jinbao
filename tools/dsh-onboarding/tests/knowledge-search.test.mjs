import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeSearch} from '../knowledge-search.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 十人胜率是 10 条极小的 aram-ranking 快照查询。它们以前和普通检索共用一个 120ms
// 的排队间隔，冷启动光排队就 1.2 秒；现在单独一条车道，4 并发、10ms 间隔。
test('roster snapshot queries use their own fast lane instead of the 120ms queue', async () => {
  const started = [];
  const search = createKnowledgeSearch(async (query) => {
    started.push(query.query);
    await sleep(20);
    return {results: [{data: {name: query.query, winRate: 50, tier: 'T2'}}]};
  }, {spacingMs: 120, bulkSpacingMs: 10, bulkConcurrency: 4});
  const t0 = performance.now();
  const rows = await Promise.all(Array.from({length: 10}, (_, i) => search({game: 'lol', query: '英雄' + i, dataset: 'aram-ranking', limit: 1})));
  const elapsed = performance.now() - t0;
  assert.equal(rows.length, 10);
  assert.equal(started.length, 10);
  // 旧串行排队约 1.2 秒；新车道应在 500ms 内完成（CI 上留足余量）。
  assert.ok(elapsed < 800, '10 roster snapshots took ' + Math.round(elapsed) + 'ms');
});

test('ordinary knowledge lookups still wait for the shared spacing window', async () => {
  const at = [];
  const search = createKnowledgeSearch(async (query) => {
    at.push(performance.now());
    return {results: [{data: {name: query.query}}]};
  }, {spacingMs: 80});
  const t0 = performance.now();
  await Promise.all(['a', 'b'].map((query) => search({game: 'lol', query})));
  // 无论哪条先发，第二条都要等 80ms 的间隔；如果间隔失效，两条会在同一个 tick 发出。
  assert.ok(at[1] - at[0] >= 50, 'ordinary lookups started ' + Math.round(at[1] - at[0]) + 'ms apart');
  assert.ok(performance.now() - t0 < 1000);
});

test('the three augment cards hydrate together instead of 120ms apart', async () => {
  const starts = [];
  const search = createKnowledgeSearch(async (query) => {
    starts.push(performance.now());
    await sleep(20);
    return {results: [{data: {name: query.filter.name, _type: 'augments'}}]};
  }, {spacingMs: 120, hotSpacingMs: 40});
  const t0 = performance.now();
  await Promise.all(['甲', '乙', '丙'].map((name) => search({game: 'lol', query: '安妮', filter: {_type: 'augments', name}, limit: 1})));
  const elapsed = performance.now() - t0;
  assert.equal(starts.length, 3);
  // 旧间隔 120ms：第三条要等到 240ms 之后才开始，页面上的 No./T 值分三批出现。
  assert.ok(elapsed < 250, 'three card lookups took ' + Math.round(elapsed) + 'ms');
});

test('roster snapshots are cached and deduplicated like any other lookup', async () => {
  let calls = 0;
  const search = createKnowledgeSearch(async () => {
    calls += 1;
    await sleep(10);
    return {results: [{data: {name: '安蓓萨', winRate: 53.55, tier: 'T3'}}]};
  });
  const query = {game: 'lol', query: '铁血狼母', dataset: 'aram-ranking', limit: 1};
  await Promise.all([search(query), search(query)]);
  assert.equal(calls, 1, 'concurrent identical roster lookups must share one request');
  await search(query);
  assert.equal(calls, 1, 'a fresh roster snapshot must come from the TTL cache');
});
