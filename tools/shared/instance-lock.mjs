import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// 金宝有两套发行形态：独立桌面版与 DSH 插件版。它们不该同时"占着屏幕说话"——
// 会出现两个悬浮窗、两个声音、两份播报。端口其实不冲突（独立版的设置端口是随机的，
// 教练也在进程内），真正冲突的是"人"这个角色：谁在屏幕上说话。
//
// 所以这里是一把跨两套的**角色锁**：先启动的一方是 owner（拥有悬浮窗与语音），
// 后启动的一方是 secondary（不抢 UI，读取 owner 的设置入口）。
// 锁放在与两套状态目录都无关的位置，避免各自被清理时互相影响。
const LOCK_DIR = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'jinbao');
const LOCK_FILE = join(LOCK_DIR, 'owner.json');

function safeRead(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function alive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * 申请"金宝 UI 所有权"。
 * @returns {{role:'owner'|'secondary'|'error', owner: object|null, lockFile: string}}
 */
export function acquireInstanceLock({ line, stateDir, settingsUrl = '', now = Date.now(), lockFile = LOCK_FILE, pid = process.pid } = {}) {
  const record = { line, pid, stateDir: stateDir ?? '', settingsUrl, startedAt: now };
  try { mkdirSync(dirname(lockFile), { recursive: true }); } catch { /* 已存在即可 */ }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(lockFile, 'wx');
      try { writeFileSync(fd, JSON.stringify(record)); } finally { closeSync(fd); }
      return { role: 'owner', owner: record, lockFile };
    } catch (error) {
      if (error.code !== 'EEXIST') return { role: 'error', owner: null, lockFile, code: error.code };
      const current = safeRead(lockFile);
      if (current && current.pid === pid) {
        // 同一进程重复 acquire（例如插件热重载）：视为仍然是 owner
        return { role: 'owner', owner: current, lockFile };
      }
      if (current && alive(current.pid)) {
        return { role: 'secondary', owner: current, lockFile };
      }
      // 持有者已经不存在：清掉再重抢。两个后来者可能同时 unlink，
      // 所以只在成功 create 时才算赢，失败就下一轮重新判定。
      try { unlinkSync(lockFile); } catch { /* 别人先删掉了，下一轮重试 */ }
    }
  }
  const owner = safeRead(lockFile);
  if (owner && alive(owner.pid)) return { role: 'secondary', owner, lockFile };
  return { role: 'error', owner, lockFile, code: 'LOCK_UNRESOLVED' };
}

/** owner 在拿到设置地址后补写进锁文件，供 secondary 复用同一个设置页。 */
export function publishSettingsUrl(url, { lockFile = LOCK_FILE, pid = process.pid } = {}) {
  const current = safeRead(lockFile);
  if (!current || current.pid !== pid) return false;
  current.settingsUrl = String(url ?? '');
  try { writeFileSync(lockFile, JSON.stringify(current)); return true; } catch { return false; }
}

export function releaseInstanceLock({ lockFile = LOCK_FILE, pid = process.pid } = {}) {
  const current = safeRead(lockFile);
  if (!current) return false;
  if (current.pid !== pid) return false;
  try { unlinkSync(lockFile); return true; } catch { return false; }
}

export function readInstanceOwner({ lockFile = LOCK_FILE } = {}) {
  const owner = safeRead(lockFile);
  if (!owner) return null;
  return alive(owner.pid) ? owner : null;
}

export const instanceLockPath = LOCK_FILE;
export const instanceLockDir = LOCK_DIR;
