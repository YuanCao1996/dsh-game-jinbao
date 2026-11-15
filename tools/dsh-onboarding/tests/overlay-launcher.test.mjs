// 插件线自动拉起悬浮窗：这里只验"该不该起、参数对不对、会不会重复起、退出有没有收尾"，
// 不真的启动进程（spawn 是注入的假实现）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOverlayLauncher } from '../overlay-launcher.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jinbao-overlay-'));
  const desktop = join(root, 'desktop-release');
  await mkdir(desktop, { recursive: true });
  await writeFile(join(desktop, 'start-overlay.ps1'), '#start');
  await writeFile(join(desktop, 'stop-overlay.ps1'), '#stop');
  return { root, desktop, stateDir: join(root, 'state') };
}

function fakeSpawn() {
  const calls = [];
  const spawn = (file, args, options) => {
    const proc = {
      pid: 4242,
      killed: false,
      exitCode: null,
      once(event, handler) { (proc._handlers ||= {})[event] = handler; return proc; },
    };
    calls.push({ file, args, options, proc });
    return proc;
  };
  return { spawn, calls };
}

test('win32 + 脚本齐全：按约定参数启动', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.deepEqual(calls[0].args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(desktop, 'start-overlay.ps1'), '-StateDir', stateDir]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(logs.at(-1).event, 'started');
});

test('重复启动不会起第二个进程', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn });

  launcher.start();
  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 1);
  assert.equal(launcher.running(), true);
});

test('子进程退出后可以再次启动', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn });

  launcher.start();
  calls[0].proc.exitCode = 0;
  calls[0].proc._handlers.exit(0);
  assert.equal(launcher.running(), false);
  assert.equal(launcher.start(), true);
  assert.equal(calls.length, 2);
});

test('非 Windows 不启动', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'linux', spawn, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
  assert.equal(logs[0].reason, 'platform');
});

test('脚本缺失时不启动也不抛异常', async () => {
  const { root } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir: join(root, 'state'), scriptRoot: join(root, 'not-there'), platform: 'win32', spawn, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
  assert.equal(logs[0].reason, 'missing-script');
});

test('没有 stateDir 不启动', async () => {
  const { desktop } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const launcher = createOverlayLauncher({ stateDir: '', scriptRoot: desktop, platform: 'win32', spawn });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
});

test('spawn 抛错时记录并返回 false', async () => {
  const { desktop, stateDir } = await fixture();
  const logs = [];
  const spawn = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(logs.at(-1).event, 'spawn-failed');
  assert.equal(logs.at(-1).code, 'EPERM');
});

test('停止会调用 stop-overlay.ps1 并清空进程引用', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn });

  launcher.start();
  assert.equal(launcher.stop(), true);
  const stopCall = calls.at(-1);
  assert.deepEqual(stopCall.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(desktop, 'stop-overlay.ps1'), '-StateDir', stateDir]);
  assert.equal(launcher.running(), false);
});

test('安装器放好脚本后路径解析符合预期', async () => {
  const { desktop, stateDir } = await fixture();
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn: fakeSpawn().spawn });
  assert.equal(existsSync(launcher.scriptPath), true);
  assert.equal(existsSync(launcher.stopScriptPath), true);
});
