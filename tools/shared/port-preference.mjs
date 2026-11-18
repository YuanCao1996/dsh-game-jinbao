// 设置页端口：以前每次启动随机分配，书签和别的工具都对不上。
// 现在优先用「上次用过的端口」，被占就退回随机，并把实际端口记下来。
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_PORT = 3084;
export const validPort = value => Number.isInteger(value) && value >= 1024 && value <= 65535;

export function preferredPort({ arg = null, saved = null, fallback = DEFAULT_PORT } = {}) {
  if (validPort(arg)) return arg;
  if (validPort(saved)) return saved;
  return validPort(fallback) ? fallback : 0;
}

export const portFilePath = stateDir => join(stateDir, 'settings-port.json');

export async function readSavedPort(stateDir) {
  try {
    const value = JSON.parse(await readFile(portFilePath(stateDir), 'utf8'));
    return validPort(value?.port) ? value.port : null;
  } catch { return null; }
}

export async function savePort(stateDir, port) {
  if (!validPort(port)) return null;
  try {
    await mkdir(stateDir, { recursive: true });
    const path = portFilePath(stateDir);
    const temporary = path + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify({ port }), { mode: 0o600 });
    await rename(temporary, path);
    return port;
  } catch { return null; }
}
