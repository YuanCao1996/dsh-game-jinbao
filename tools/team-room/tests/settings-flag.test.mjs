import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTeamFlag, writeTeamFlag, teamFlagPath } from '../settings-flag.mjs';

test('没有开关文件时默认关闭', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-team-flag-'));
  try {
    assert.deepEqual(await readTeamFlag(dir), { enabled: false, byokHost: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('写开关能读回来，且只改指定的那一项', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-team-flag-'));
  try {
    assert.deepEqual(await writeTeamFlag(dir, { enabled: true }), { enabled: true, byokHost: false });
    assert.deepEqual(await readTeamFlag(dir), { enabled: true, byokHost: false });
    assert.deepEqual(await writeTeamFlag(dir, { byokHost: true }), { enabled: true, byokHost: true });
    assert.deepEqual(await writeTeamFlag(dir, { enabled: false }), { enabled: false, byokHost: true });
    const raw = JSON.parse(await readFile(teamFlagPath(dir), 'utf8'));
    assert.deepEqual(raw, { enabled: false, byokHost: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('文件被写坏时按关闭处理，不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-team-flag-'));
  try {
    await writeFile(teamFlagPath(dir), '{坏掉的 json');
    assert.deepEqual(await readTeamFlag(dir), { enabled: false, byokHost: false });
    await writeFile(teamFlagPath(dir), JSON.stringify({ enabled: 'yes' }));
    assert.deepEqual(await readTeamFlag(dir), { enabled: false, byokHost: false }, '字符串 true 不算开启');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
