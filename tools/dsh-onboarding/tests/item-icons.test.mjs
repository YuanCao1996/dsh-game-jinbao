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
