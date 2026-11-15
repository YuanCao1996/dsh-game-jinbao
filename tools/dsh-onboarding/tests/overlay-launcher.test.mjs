// 插件线自动拉起悬浮窗：这里只验"该不该起、参数对不对、会不会重复、退出有没有收尾"，
// 不真的启动进程（spawn / runSync 都是注入的假实现）。
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

// 默认：探测说"没有同 StateDir 的悬浮窗"
const noOverlay = () => '0 0';
const hasOverlay = () => '1 1\r\n';

function makeLauncher(extra = {}) {
  const { spawn, calls } = fakeSpawn();
  const runs = [];
  const runSync = (file, args, options) => {
    runs.push({ file, args, options });
    const probe = args.find((a) => typeof a === 'string' && a.includes('strategy-overlay'));
    return probe ? (extra.probe ?? noOverlay)() : '';
  };
  const logs = [];
  const stateDirPromise = extra.stateDir ?? fixture();
  return { spawn, calls, runs, logs, runSync, stateDirPromise };
}

test('win32 + 脚本齐全：按约定参数启动', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync: noOverlay, onLog: (e) => logs.push(e) });

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
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync: noOverlay });

  launcher.start();
  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 1);
  assert.equal(launcher.running(), true);
});

test('已有同 StateDir 的悬浮窗时不再起新的（这是重复窗口的根因）', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync: hasOverlay, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
  assert.equal(logs.at(-1).reason, 'overlay-already-visible');
});

test('探测失败时不阻止启动（宁可多一个窗口，也别让形象消失）', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const runSync = () => { throw Object.assign(new Error('probe denied'), { code: 'EPERM' }); };
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), true);
  assert.equal(calls.length, 1);
  assert.ok(logs.some((e) => e.event === 'probe-failed'));
});

test('子进程退出后可以再次启动', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync: noOverlay });

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
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'linux', spawn, runSync: noOverlay, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
  assert.equal(logs[0].reason, 'platform');
});

test('脚本缺失时不启动也不抛异常', async () => {
  const { root } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir: join(root, 'state'), scriptRoot: join(root, 'not-there'), platform: 'win32', spawn, runSync: noOverlay, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
  assert.equal(logs[0].reason, 'missing-script');
});

test('没有 stateDir 不启动', async () => {
  const { desktop } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const launcher = createOverlayLauncher({ stateDir: '', scriptRoot: desktop, platform: 'win32', spawn, runSync: noOverlay });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
});

test('spawn 抛错时记录并返回 false', async () => {
  const { desktop, stateDir } = await fixture();
  const logs = [];
  const spawn = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync: noOverlay, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(logs.at(-1).event, 'spawn-failed');
  assert.equal(logs.at(-1).code, 'EPERM');
});

test('停止是同步的：调用 stop-overlay.ps1 并用 runSync 等它收尾', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const runs = [];
  const runSync = (file, args) => { runs.push({ file, args }); return '0'; };
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync });

  launcher.start();
  assert.equal(launcher.stop(), true);
  const stopRun = runs.at(-1);
  assert.deepEqual(stopRun.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(desktop, 'stop-overlay.ps1'), '-StateDir', stateDir]);
  assert.equal(launcher.running(), false);
});

test('停止后可以重新启动，且不会和旧窗口并存', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  let probeCount = 0;
  // stop 之后探测应回到 0
  const runSync = (file, args) => (args.some((a) => typeof a === 'string' && a.includes('strategy-overlay')) ? String(probeCount) : '');

  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync });
  launcher.start();
  assert.equal(calls.length, 1);
  launcher.stop();
  probeCount = 0;
  assert.equal(launcher.start(), true);
  assert.equal(calls.length, 2);
});

test('停止失败时记录 stop-failed，但不卡住后续启动', async () => {
  // 覆盖 finally 复位 stopping，避免一次失败把后续所有启动都锁死
  const { desktop, stateDir } = await fixture();
  const { spawn } = fakeSpawn();
  let throwOnStop = true;
  const runSync = (file, args) => {
    if (args.some((a) => typeof a === 'string' && a.includes('stop-overlay'))) {
      if (throwOnStop) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    }
    return '0';
  };
  const logs = [];
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync, onLog: (e) => logs.push(e) });

  assert.equal(launcher.stop(), false);
  assert.ok(logs.some((e) => e.event === 'stop-failed'));
  throwOnStop = false;
  assert.equal(launcher.start(), true);
});

test('安装器放好脚本后路径解析符合预期', async () => {
  const { desktop, stateDir } = await fixture();
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn: fakeSpawn().spawn, runSync: noOverlay });
  assert.equal(existsSync(launcher.scriptPath), true);
  assert.equal(existsSync(launcher.stopScriptPath), true);
});

test('探测命令用正斜杠小写路径比较（命令行里是反斜杠，直接比会永远匹配不到）', async () => {
  const { desktop, stateDir } = await fixture();
  const runs = [];
  const runSync = (file, args) => { runs.push(args.join(' ')); return '0'; };
  const launcher = createOverlayLauncher({ stateDir: 'C:\\Temp\\State', scriptRoot: desktop, platform: 'win32', spawn: fakeSpawn().spawn, runSync });
  launcher.existingOverlay();
  const query = runs.find((q) => q.includes('strategy-overlay'));
  assert.ok(query, '应该执行了探测');
  assert.ok(query.includes('c:/temp/state'), '探测里应出现小写正斜杠路径: ' + query);
  assert.ok(!query.includes('\\"'), 'PS 字符串里不能出现 JS 风格的转义引号: ' + query);
});

test('停止是同步的：后续启动不会与旧窗口并存（顺序 stop → start）', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const order = [];
  const runSync = (file, args) => {
    if (args.some((a) => typeof a === 'string' && a.includes('stop-overlay'))) order.push('stop');
    else if (args.some((a) => typeof a === 'string' && a.includes('strategy-overlay'))) order.push('probe');
    return '0';
  };
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync });
  launcher.start();
  launcher.stop();
  order.push('restart');
  launcher.start();
  assert.deepEqual(order, ['probe', 'stop', 'restart', 'probe']);
  assert.equal(calls.length, 2);
});

test('别的 StateDir 已有金宝悬浮窗时也不起（独立版与插件版共存会叠窗、抢端口）', async () => {
  const { desktop, stateDir } = await fixture();
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const runSync = () => '1 0';
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn, runSync, onLog: (e) => logs.push(e) });

  assert.equal(launcher.start(), false);
  assert.equal(calls.length, 0);
  assert.equal(logs.at(-1).reason, 'another-jinbao-overlay-running');
});

test('overlayCounts 能分别报出 all / mine', async () => {
  const { desktop, stateDir } = await fixture();
  const runSync = () => '3 1';
  const launcher = createOverlayLauncher({ stateDir, scriptRoot: desktop, platform: 'win32', spawn: fakeSpawn().spawn, runSync });
  assert.deepEqual(launcher.overlayCounts(), { all: 3, mine: 1 });
  assert.equal(launcher.existingOverlay(), true);
});
