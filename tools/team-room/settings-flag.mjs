// 「测试功能」开关：开黑队伍这类没验收的功能，不应该只靠命令行参数。
// 设置页写这个文件，下次启动由 main.mjs 读取；进程内是否真的启用仍以启动参数为准。
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const teamFlagPath = stateDir => join(stateDir, 'team-rooms.json');
const EMPTY = { enabled: false, byokHost: false };

export async function readTeamFlag(stateDir) {
  try {
    const value = JSON.parse(await readFile(teamFlagPath(stateDir), 'utf8'));
    return { enabled: value?.enabled === true, byokHost: value?.byokHost === true };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeTeamFlag(stateDir, patch = {}) {
  const current = await readTeamFlag(stateDir);
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    byokHost: typeof patch.byokHost === 'boolean' ? patch.byokHost : current.byokHost,
  };
  const path = teamFlagPath(stateDir);
  await mkdir(stateDir, { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, path);
  return next;
}
