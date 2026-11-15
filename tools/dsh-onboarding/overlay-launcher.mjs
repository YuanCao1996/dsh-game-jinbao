import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 插件线原来没有悬浮窗入口：独立版的 main.mjs 和启动器的 start.ps1 才会拉起它，
// 于是"只装插件"的结果是有教练、有设置页、但看不到形象。
// 这里让 onboarding 插件自己拉起悬浮窗，DSH 一启动就有形象。
//
// 依赖安装器把 desktop-release 与 jinbao-launcher 放在同一个包里保持同级
// （start-overlay.ps1 会 dot-source ..\jinbao-launcher\legacy-overlay.ps1）。
//
// 重复窗口的教训（两种都踩过）：
//   1) 旧 stop() 只把退出请求丢出去就返回，紧接着的 start() 会在旧窗口还没退时再起一个；
//      现在 stop() 同步等脚本收尾（runSync），start/stop 天然串行。
//   2) 独立版与插件版各有一个 StateDir，只比 StateDir 挡不住它们同时起两个窗口；
//      现在启动前统计"所有金宝悬浮窗"，只要已经有一个就不起（并在日志里写明原因）。
const PS = 'powershell.exe';
const BASE_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];

export function createOverlayLauncher({
  stateDir,
  scriptRoot,
  platform = process.platform,
  spawn = nodeSpawn,
  runSync = execFileSync,
  onLog = () => {},
} = {}) {
  const startScript = scriptRoot ? join(scriptRoot, 'start-overlay.ps1') : '';
  const stopScript = scriptRoot ? join(scriptRoot, 'stop-overlay.ps1') : '';
  let child = null;
  let stopping = false;

  const running = () => !!child && child.exitCode === null && !child.killed;

  // 已经在跑的金宝悬浮窗数量：
  //   all  —— 不分 StateDir（独立版、插件版各一个 StateDir，两边各起一个就会在屏幕上叠两个窗口）
  //   mine —— 同 StateDir（同一套被重复拉起）
  // 用 -Command 直接查进程命令行，比 -File 调脚本快一个数量级。
  function overlayCounts() {
    if (!stateDir) return { all: 0, mine: 0 };
    try {
      // needle 不能包引号：JSON.stringify 会把引号转成 \"，而 PowerShell 的转义符是反引号，
      // 直接语法错误（表现就是 probe-failed）。这里只放小写正斜杠的裸路径。
      const needle = stateDir.replace(/\\/g, '/').toLowerCase();
      const query = [
        '$d=' + JSON.stringify(needle) + ';',
        "$p=@(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" -ErrorAction SilentlyContinue |",
        "Where-Object { $_.CommandLine -match 'strategy-overlay\\.ps1' });",
        "$mine=@($p | Where-Object { $_.CommandLine.Replace('\\','/').ToLower().Contains($d) });",
        '"$($p.Count) $($mine.Count)"',
      ].join(' ');
      const out = runSync(PS, ['-NoProfile', '-Command', query], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parts = String(out).trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
      return {
        all: Number.isFinite(parts[0]) ? parts[0] : 0,
        mine: Number.isFinite(parts[1]) ? parts[1] : 0,
      };
    } catch (error) {
      // 探测失败不阻止启动：宁可多开一个窗口，也不要因为查询异常让形象消失
      onLog({ event: 'probe-failed', code: error?.code ?? null });
      return { all: 0, mine: 0 };
    }
  }

  function existingOverlay() {
    return overlayCounts().all > 0;
  }

  function start() {
    if (platform !== 'win32') {
      onLog({ event: 'skip', reason: 'platform', platform });
      return false;
    }
    if (!stateDir) {
      onLog({ event: 'skip', reason: 'no-state-dir' });
      return false;
    }
    if (!startScript || !existsSync(startScript)) {
      onLog({ event: 'skip', reason: 'missing-script', script: startScript });
      return false;
    }
    if (stopping) {
      onLog({ event: 'skip', reason: 'stopping' });
      return false;
    }
    if (running()) {
      onLog({ event: 'skip', reason: 'already-running' });
      return false;
    }
    const counts = overlayCounts();
    if (counts.mine > 0) {
      onLog({ event: 'skip', reason: 'overlay-already-visible', count: counts.mine });
      return false;
    }
    if (counts.all > 0) {
      // 独立版和插件版各有各的 StateDir，但同机同时跑会抢 3081/3084 并在脸上叠两个窗口。
      // 宁可不显示，也不叠。
      onLog({ event: 'skip', reason: 'another-jinbao-overlay-running', count: counts.all });
      return false;
    }
    try {
      // 不 detached：DSH 退出时随宿主一起结束，避免留下孤儿悬浮窗。
      const proc = spawn(PS, [...BASE_ARGS, startScript, '-StateDir', stateDir], {
        windowsHide: true,
        stdio: 'ignore',
      });
      child = proc;
      onLog({ event: 'started', pid: proc.pid ?? null, script: startScript });
      if (typeof proc.once === 'function') {
        // 注意：start-overlay.ps1 本身是短命脚本 —— 它 Start-Process 出真正的悬浮窗就退出了。
        // 所以这里记 launcher-exit（code 0 表示脚本正常跑完），不代表悬浮窗挂了。
        proc.once('exit', (code) => { child = null; onLog({ event: 'launcher-exit', code }); });
        proc.once('error', (error) => { child = null; onLog({ event: 'launcher-error', code: error?.code ?? null }); });
      }
      return true;
    } catch (error) {
      child = null;
      onLog({ event: 'spawn-failed', code: error?.code ?? null });
      return false;
    }
  }

  // 同步：stop-overlay.ps1 自己会等 2 秒并要求窗口退出，这里等它跑完再返回，
  // 后续的 start() 就不会和旧窗口撞车。
  function stop() {
    if (!stopScript || !existsSync(stopScript)) {
      onLog({ event: 'stop-skip', reason: 'missing-script' });
      return false;
    }
    if (stopping) {
      onLog({ event: 'stop-skip', reason: 'already-stopping' });
      return false;
    }
    stopping = true;
    try {
      runSync(PS, [...BASE_ARGS, stopScript, '-StateDir', stateDir], {
        timeout: 15000,
        windowsHide: true,
        stdio: 'ignore',
      });
      onLog({ event: 'stopped' });
      child = null;
      return true;
    } catch (error) {
      onLog({ event: 'stop-failed', code: error?.code ?? null });
      return false;
    } finally {
      stopping = false;
    }
  }

  return {
    start,
    stop,
    running,
    existingOverlay,
    overlayCounts,
    scriptPath: startScript,
    stopScriptPath: stopScript,
  };
}
