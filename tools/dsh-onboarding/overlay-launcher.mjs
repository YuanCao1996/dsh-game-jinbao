import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 插件线原来没有悬浮窗入口：独立版的 main.mjs 和启动器的 start.ps1 才会拉起它，
// 于是"只装插件"的结果是有教练、有设置页、但看不到形象。
// 这里让 onboarding 插件自己拉起悬浮窗，DSH 一启动就有形象。
//
// 依赖安装器把 tools/desktop-release 与 tools/jinbao-launcher 放到 profiles/node_modules 里
// （两者必须同级：start-overlay.ps1 会 dot-source ..\jinbao-launcher\legacy-overlay.ps1）。
export function createOverlayLauncher({
  stateDir,
  scriptRoot,
  platform = process.platform,
  spawn = nodeSpawn,
  onLog = () => {},
} = {}) {
  const startScript = scriptRoot ? join(scriptRoot, 'start-overlay.ps1') : '';
  const stopScript = scriptRoot ? join(scriptRoot, 'stop-overlay.ps1') : '';
  let child = null;

  const running = () => !!child && child.exitCode === null && !child.killed;

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
    if (running()) {
      onLog({ event: 'skip', reason: 'already-running' });
      return false;
    }
    try {
      // 不 detached：DSH 退出时随宿主一起结束，避免留下孤儿悬浮窗。
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', startScript, '-StateDir', stateDir],
        { windowsHide: true, stdio: 'ignore' },
      );
      child = proc;
      onLog({ event: 'started', pid: proc.pid ?? null, script: startScript });
      if (typeof proc.once === 'function') {
        proc.once('exit', (code) => { child = null; onLog({ event: 'exit', code }); });
        proc.once('error', (error) => { child = null; onLog({ event: 'error', code: error?.code ?? null }); });
      }
      return true;
    } catch (error) {
      child = null;
      onLog({ event: 'spawn-failed', code: error?.code ?? null });
      return false;
    }
  }

  function stop() {
    if (!stopScript || !existsSync(stopScript)) {
      onLog({ event: 'stop-skip', reason: 'missing-script' });
      return false;
    }
    try {
      spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stopScript, '-StateDir', stateDir],
        { windowsHide: true, stdio: 'ignore' },
      );
      onLog({ event: 'stopped' });
      child = null;
      return true;
    } catch (error) {
      onLog({ event: 'stop-failed', code: error?.code ?? null });
      return false;
    }
  }

  return { start, stop, running, scriptPath: startScript, stopScriptPath: stopScript };
}
