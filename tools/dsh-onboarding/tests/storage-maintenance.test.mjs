import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageMaintenance } from '../storage-maintenance.mjs';

const DAY = 24 * 60 * 60 * 1000;

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jinbao-storage-'));
  await mkdir(join(root, 'updates', 'releases', 'v0.2.1'), { recursive: true });
  await mkdir(join(root, 'updates', 'releases', 'v0.2.2'), { recursive: true });
  await mkdir(join(root, 'updates', 'releases', 'v0.2.3'), { recursive: true });
  await mkdir(join(root, 'updates', 'releases', 'v0.2.4'), { recursive: true });
  await writeFile(join(root, 'updates', 'releases', 'v0.2.4', 'x.bin'), 'x'.repeat(2048));
  await writeFile(join(root, 'updates', 'releases', 'v0.2.1', 'x.bin'), 'x'.repeat(2048));
  await writeFile(join(root, 'launcher-state.json'), JSON.stringify({ version: '0.2.4-standalone-preview.1' }));
  await mkdir(join(root, 'game-memory'), { recursive: true });
  for (let i = 0; i < 5; i++) {
    const file = join(root, 'game-memory', `m${i}.jsonl`);
    await writeFile(file, 'x'.repeat(1024));
    const age = i === 0 ? 40 * DAY : i * DAY;
    await utimes(file, new Date(Date.now() - age), new Date(Date.now() - age));
  }
  await mkdir(join(root, 'logs'), { recursive: true });
  for (let i = 0; i < 4; i++) {
    const file = join(root, 'logs', `l${i}.jsonl`);
    await writeFile(file, 'x'.repeat(1024));
    const age = i === 0 ? 30 * DAY : 2 * DAY;
    await utimes(file, new Date(Date.now() - age), new Date(Date.now() - age));
  }
  await mkdir(join(root, 'logs-archive-stale'), { recursive: true });
  await writeFile(join(root, 'logs-archive-stale', 'old.log'), 'x');
  await utimes(join(root, 'logs-archive-stale'), new Date(Date.now() - 30 * DAY), new Date(Date.now() - 30 * DAY));
  return root;
}

test('releases 只保留配置数量与当前版本', async () => {
  const root = await fixture();
  try {
    const storage = createStorageMaintenance({ stateDir: root, limits: { keepReleases: 2 } });
    const result = await storage.cleanup('releases');
    assert.deepEqual(result.result.releases.kept, ['v0.2.3', 'v0.2.4']);
    assert.equal(await exists(join(root, 'updates', 'releases', 'v0.2.1')), false);
    assert.equal(await exists(join(root, 'updates', 'releases', 'v0.2.4')), true);
    assert.ok(result.freedBytes > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('对局记忆按天数和文件数双重保留', async () => {
  const root = await fixture();
  try {
    const storage = createStorageMaintenance({ stateDir: root, limits: { memoryDays: 30, memoryMaxFiles: 2 } });
    await storage.cleanup('memory');
    const left = (await readdirSafe(join(root, 'game-memory'))).sort();
    assert.deepEqual(left, ['m1.jsonl', 'm2.jsonl']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('日志按天数清理，且不动刚刚写入的文件', async () => {
  const root = await fixture();
  try {
    const storage = createStorageMaintenance({ stateDir: root, limits: { logsDays: 14 } });
    const active = join(root, 'logs', 'active.jsonl');
    await writeFile(active, 'x');
    await storage.cleanup('logs');
    assert.equal(await exists(join(root, 'logs', 'l0.jsonl')), false);
    assert.equal(await exists(active), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('过期 legacy 目录会被清掉，新目录保留', async () => {
  const root = await fixture();
  try {
    const storage = createStorageMaintenance({ stateDir: root, limits: { legacyDays: 14 } });
    await storage.cleanup('legacy');
    assert.equal(await exists(join(root, 'logs-archive-stale')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function readdirSafe(path) {
  const { readdir } = await import('node:fs/promises');
  try { return await readdir(path); } catch { return []; }
}

test('迁移校验：目标不能与当前目录相同/互相包含', async () => {
  const root = await fixture();
  try {
    const storage = createStorageMaintenance({ stateDir: root });
    await assert.rejects(storage.migrate(root), error => error.status === 400);
    await assert.rejects(storage.migrate(join(root, 'inside')), error => error.status === 400);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('迁移校验：目标文件夹必须为空文件夹', async () => {
  const root = await fixture();
  const target = await mkdtemp(join(tmpdir(), 'jinbao-target-'));
  try {
    await writeFile(join(target, 'x.txt'), 'x');
    const storage = createStorageMaintenance({ stateDir: root });
    await assert.rejects(storage.migrate(target), error => error.status === 409);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});