import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createItemIconStore, ITEM_ICON_CDN_ROOT} from '../item-icons.mjs';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test('icon store keeps a whitelist, caches downloads and dedupes concurrent requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-item-icons-'));
  const urls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const store = createItemIconStore({
    stateDir: dir,
    paths: {'3031': 'assets/items/icons2d/3031_marksman_t3_infinityedge.png'},
    fetchImpl: async (url) => { urls.push(String(url)); await gate; return new Response(png, {status: 200, headers: {'content-type': 'image/png'}}); },
  });
  try {
    assert.equal(store.has('3031'), true);
    assert.equal(store.has('../etc/passwd'), false);
    assert.equal(await store.get('../etc/passwd'), null);
    assert.equal(await store.get('9999'), null);
    const pending = [store.get('3031'), store.get('3031')];
    release();
    const [first, second] = await Promise.all(pending);
    assert.ok(first?.bytes?.length > 0);
    assert.equal(second, first, 'concurrent requests must share one download');
    assert.deepEqual(urls, [ITEM_ICON_CDN_ROOT + 'assets/items/icons2d/3031_marksman_t3_infinityedge.png']);
    // Cached on disk and in memory: a new store instance must not hit the network.
    const reopened = createItemIconStore({stateDir: dir, paths: {}, fetchImpl: async () => { throw Error('network must not be used'); }});
    const cached = await reopened.get('3031');
    assert.ok(cached?.bytes?.length > 0);
    assert.equal((await readFile(join(dir, 'item-icons/3031.png'))).length, png.length);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('prefetch warms every bundled mapping entry and skips already cached files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-item-prefetch-'));
  let calls = 0;
  const store = createItemIconStore({
    stateDir: dir,
    paths: {'1001': 'assets/a.png', '3031': 'assets/b.png', '3153': 'assets/c.png'},
    fetchImpl: async () => { calls += 1; return new Response(png, {status: 200, headers: {'content-type': 'image/png'}}); },
  });
  try {
    const first = await store.prefetch({concurrency: 2, spacingMs: 0});
    assert.deepEqual({total: first.total, added: first.added, failed: first.failed}, {total: 3, added: 3, failed: 0});
    assert.equal(calls, 3);
    assert.equal(await store.cachedCount(), 3);
    // 第二次启动：只补缺失的，不再联网。
    calls = 0;
    const second = await store.prefetch({concurrency: 2, spacingMs: 0});
    assert.equal(second.total, 0);
    assert.equal(calls, 0);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('prefetch stops after repeated failures and when the caller asks it to stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-item-prefetch-'));
  const failing = createItemIconStore({
    stateDir: dir,
    paths: Object.fromEntries(Array.from({length: 20}, (_, i) => [String(1000 + i), 'assets/x.png'])),
    fetchImpl: async () => new Response('no', {status: 503}),
  });
  const result = await failing.prefetch({concurrency: 2, spacingMs: 0, stopAfterFailures: 3});
  assert.equal(result.stopped, true);
  assert.equal(result.added, 0);
  assert.ok(result.failed >= 3, 'failed ' + result.failed);
  assert.ok(result.failed < result.total, 'must not try every entry after repeated failures');

  const stopping = createItemIconStore({
    stateDir: dir,
    paths: {'2001': 'assets/a.png', '2002': 'assets/b.png', '2003': 'assets/c.png'},
    fetchImpl: async () => new Response(png, {status: 200, headers: {'content-type': 'image/png'}}),
  });
  let done = 0;
  const stopped = await stopping.prefetch({concurrency: 1, spacingMs: 0, shouldStop: () => done++ >= 1});
  assert.equal(stopped.stopped, true);
  assert.ok(stopped.added <= 2);
  await rm(dir, {recursive: true, force: true});
});

test('icon store returns null for unknown ids, failed downloads and oversized responses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-item-icons-'));
  const bad = createItemIconStore({
    stateDir: dir,
    paths: {'3031': 'assets/a.png', '3153': 'assets/b.png'},
    fetchImpl: async (url) => String(url).endsWith('a.png')
      ? new Response('nope', {status: 404})
      : new Response(Buffer.alloc(300 * 1024), {status: 200, headers: {'content-type': 'image/png'}}),
  });
  try {
    assert.equal(await bad.get('3031'), null);
    assert.equal(await bad.get('3153'), null);
    assert.equal(await bad.get('1234'), null);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
