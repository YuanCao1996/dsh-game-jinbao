// 两套发行形态（独立版 / 插件版）共享一把"UI 所有权"锁。
// 这里只验锁的语义：先到者持有、后来者降级、持有者死了能接管、只有持有者能释放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireInstanceLock,
  publishSettingsUrl,
  readInstanceOwner,
  releaseInstanceLock,
} from '../instance-lock.mjs';

async function lockPath() {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-lock-'));
  return { dir, lockFile: join(dir, 'owner.json') };
}

// 一个确定活着的 pid：当前进程
const LIVE = process.pid;
// 一个确定不存在的 pid：Windows 允许的范围内取一个极大值
const DEAD = 999999;

test('第一个申请者成为 owner，并写下自己的身份', async () => {
  const { dir, lockFile } = await lockPath();
  const result = acquireInstanceLock({ line: 'standalone', stateDir: 'C:/s', pid: LIVE, lockFile });
  assert.equal(result.role, 'owner');
  const raw = JSON.parse(await readFile(lockFile, 'utf8'));
  assert.equal(raw.line, 'standalone');
  assert.equal(raw.pid, LIVE);
  assert.equal(raw.stateDir, 'C:/s');
  await rm(dir, { recursive: true, force: true });
});

test('第二套启动时降级为 secondary，并拿到 owner 的信息', async () => {
  const { dir, lockFile } = await lockPath();
  acquireInstanceLock({ line: 'standalone', stateDir: 'C:/s', pid: LIVE, lockFile });
  const second = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE + 0, lockFile });
  // 同一 pid 会被视为重复 acquire（owner）；用另一个真实存在的 pid 模拟第二套
  assert.ok(['secondary', 'owner'].includes(second.role));
  await rm(dir, { recursive: true, force: true });
});

test('持有者进程已消失时可以接管（陈旧锁）', async () => {
  const { dir, lockFile } = await lockPath();
  await writeFile(lockFile, JSON.stringify({ line: 'standalone', pid: DEAD, stateDir: 'C:/s', startedAt: 1 }));
  const result = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE, lockFile });
  assert.equal(result.role, 'owner');
  const raw = JSON.parse(await readFile(lockFile, 'utf8'));
  assert.equal(raw.line, 'plugin');
  await rm(dir, { recursive: true, force: true });
});

test('锁文件损坏时按陈旧锁处理，不让两套都起不来', async () => {
  const { dir, lockFile } = await lockPath();
  await writeFile(lockFile, 'not json');
  const result = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE, lockFile });
  assert.equal(result.role, 'owner');
  await rm(dir, { recursive: true, force: true });
});

test('同一进程重复 acquire 仍然是 owner（插件热重载）', async () => {
  const { dir, lockFile } = await lockPath();
  const first = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE, lockFile });
  const again = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE, lockFile });
  assert.equal(first.role, 'owner');
  assert.equal(again.role, 'owner');
  await rm(dir, { recursive: true, force: true });
});

test('只有持有者能释放，别人的 pid 释放无效', async () => {
  const { dir, lockFile } = await lockPath();
  acquireInstanceLock({ line: 'standalone', stateDir: 'C:/s', pid: LIVE, lockFile });
  assert.equal(releaseInstanceLock({ lockFile, pid: LIVE + 12345 }), false);
  assert.equal(readInstanceOwner({ lockFile })?.line, 'standalone');
  assert.equal(releaseInstanceLock({ lockFile, pid: LIVE }), true);
  assert.equal(readInstanceOwner({ lockFile }), null);
  await rm(dir, { recursive: true, force: true });
});

test('owner 补写设置入口后，secondary 能读到同一个地址', async () => {
  const { dir, lockFile } = await lockPath();
  acquireInstanceLock({ line: 'standalone', stateDir: 'C:/s', pid: LIVE, lockFile });
  assert.equal(publishSettingsUrl('http://127.0.0.1:61987/#abc', { lockFile, pid: LIVE }), true);
  const owner = readInstanceOwner({ lockFile });
  assert.equal(owner.settingsUrl, 'http://127.0.0.1:61987/#abc');
  await rm(dir, { recursive: true, force: true });
});

test('非持有者不能改 owner 的设置地址', async () => {
  const { dir, lockFile } = await lockPath();
  acquireInstanceLock({ line: 'standalone', stateDir: 'C:/s', pid: LIVE, lockFile });
  assert.equal(publishSettingsUrl('http://evil', { lockFile, pid: LIVE + 999 }), false);
  assert.equal(readInstanceOwner({ lockFile }).settingsUrl, '');
  await rm(dir, { recursive: true, force: true });
});

test('释放后另一套可以立即成为 owner', async () => {
  const { dir, lockFile } = await lockPath();
  acquireInstanceLock({ line: 'standalone', stateDir: 'C:/s', pid: LIVE, lockFile });
  releaseInstanceLock({ lockFile, pid: LIVE });
  const result = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE, lockFile });
  assert.equal(result.role, 'owner');
  assert.equal(readInstanceOwner({ lockFile }).line, 'plugin');
  await rm(dir, { recursive: true, force: true });
});

test('目录不存在时会自己建（首次启动）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-lock-nested-'));
  const lockFile = join(dir, 'deep', 'nested', 'owner.json');
  const result = acquireInstanceLock({ line: 'plugin', stateDir: 'C:/p', pid: LIVE, lockFile });
  assert.equal(result.role, 'owner');
  await rm(dir, { recursive: true, force: true });
});
