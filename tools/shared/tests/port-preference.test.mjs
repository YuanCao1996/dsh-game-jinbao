import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preferredPort, validPort, readSavedPort, savePort, DEFAULT_PORT, portFilePath } from '../port-preference.mjs';

test('端口优先级：命令行 > 上次用过 > 默认 3084', () => {
  assert.equal(preferredPort({ arg: 4001, saved: 4002 }), 4001);
  assert.equal(preferredPort({ arg: null, saved: 4002 }), 4002);
  assert.equal(preferredPort({}), DEFAULT_PORT);
  assert.equal(preferredPort({ arg: 80 }), DEFAULT_PORT, '低于 1024 不采用');
  assert.equal(preferredPort({ arg: 70000 }), DEFAULT_PORT, '越界不采用');
  assert.equal(preferredPort({ arg: 'abc' }), DEFAULT_PORT);
  assert.equal(validPort(3084), true);
  assert.equal(validPort(0), false, '0 表示随机，不写进配置');
});

test('端口记在本地：写进去能读回来，坏了也不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-port-'));
  try {
    assert.equal(await readSavedPort(dir), null);
    assert.equal(await savePort(dir, 3084), 3084);
    assert.equal(await readSavedPort(dir), 3084);
    assert.equal(await savePort(dir, 0), null, '随机端口不落盘');
    await writeFile(portFilePath(dir), '{坏 json');
    assert.equal(await readSavedPort(dir), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
