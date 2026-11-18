// 第一篇日记里，她想「打量」一下这台电脑。只取粗粒度配置，不取序列号/MAC/用户名/路径。
// 采集失败就当作不知道，不要让第一篇写不出来。
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// 内嵌而不是外部 .ps1：构建时只会跟着 import 图走，外部脚本很容易漏进包里（漏过一次）。
// -EncodedCommand 用 UTF-16LE base64，避免中文和引号在命令行上被拆坏。
const PROFILE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
function Safe([scriptblock]$block, $fallback) { try { & $block } catch { $fallback } }
$cpu = Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 } $null
$cs = Safe { Get-CimInstance Win32_ComputerSystem } $null
$os = Safe { Get-CimInstance Win32_OperatingSystem } $null
$gpus = Safe { @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) } @()
$disks = Safe { @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ letter = $_.DeviceID; totalGb = [math]::Round($_.Size / 1GB); freeGb = [math]::Round($_.FreeSpace / 1GB) } }) } @()
$screen = Safe { $v = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -gt 0 } | Select-Object -First 1; if ($v) { '{0}x{1}' -f $v.CurrentHorizontalResolution, $v.CurrentVerticalResolution } else { $null } } $null
$profile = [pscustomobject]@{
  cpu = if ($cpu) { $cpu.Name } else { $null }
  cores = if ($cpu) { $cpu.NumberOfCores } else { $null }
  threads = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { $null }
  memoryGb = if ($cs) { [math]::Round($cs.TotalPhysicalMemory / 1GB) } else { $null }
  manufacturer = if ($cs) { $cs.Manufacturer } else { $null }
  model = if ($cs) { $cs.Model } else { $null }
  os = if ($os) { $os.Caption } else { $null }
  gpus = $gpus
  disks = $disks
  screen = $screen
}
[Console]::Out.Write(($profile | ConvertTo-Json -Compress -Depth 4))
`;
const encodedScript = () => Buffer.from(PROFILE_SCRIPT, 'utf16le').toString('base64');

const GPU_NOISE = /(oray|idd|remote|basic|virtual|mirror|parsec|vmware|hyper-v|citrix|microsoft basic)/i;

export function cleanName(value, max = 60) {
  return String(value ?? '')
    .replace(/\((r|tm|注册商标|商标)\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*(co\.,? ?ltd\.?|technolog.*|corporation|inc\.?)$/i, '')
    .trim()
    .slice(0, max);
}

// "12th Gen Intel(R) Core(TM) i5-12490F" → "i5-12490F"；认不出就退回清理后的全名。
export function cpuShort(name) {
  const text = cleanName(name, 80);
  const intel = /(i[3579]-[0-9]{3,5}[A-Za-z]{0,2})/.exec(text);
  if (intel) return intel[1];
  const ryzen = /(ryzen\s*[3579]\s*[0-9]{4}[A-Za-z]{0,3})/i.exec(text);
  if (ryzen) return ryzen[1].replace(/\s+/g, ' ');
  const ultra = /(ultra\s*[3579]\s*[0-9]{3}[A-Za-z]?)/i.exec(text);
  if (ultra) return ultra[1].replace(/\s+/g, ' ');
  return text.split(' ').slice(-2).join(' ');
}

export function realGpus(list = []) {
  return (Array.isArray(list) ? list : [])
    .map(name => cleanName(name, 40))
    .filter(name => name && !GPU_NOISE.test(name))
    .slice(0, 2);
}

// 只白名单字段：以后就算采集脚本多吐了序列号，也不会进提示词。
export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = (value, max) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : null);
  const disks = (Array.isArray(raw.disks) ? raw.disks : [])
    .map(disk => ({
      letter: /^[A-Z]:$/.test(String(disk?.letter ?? '')) ? String(disk.letter) : null,
      totalGb: number(disk?.totalGb, 100000),
      freeGb: number(disk?.freeGb, 100000),
    }))
    .filter(disk => disk.letter && disk.totalGb)
    .slice(0, 4);
  const profile = {
    cpu: cleanName(raw.cpu, 60) || null,
    cores: number(raw.cores, 512),
    threads: number(raw.threads, 1024),
    memoryGb: number(raw.memoryGb, 4096),
    model: cleanName(raw.model, 60) || null,
    manufacturer: cleanName(raw.manufacturer, 40) || null,
    os: cleanName(raw.os, 60) || null,
    gpus: realGpus(raw.gpus),
    disks,
    screen: /^\d{3,5}x\d{3,5}$/.test(String(raw.screen ?? '')) ? String(raw.screen) : null,
  };
  const empty = !profile.cpu && !profile.memoryGb && !profile.disks.length && !profile.gpus.length && !profile.model;
  return empty ? null : profile;
}

// 给模型看的一句话：像「她看到的」，不是参数表。
export function describeMachine(profile) {
  if (!profile) return '';
  const parts = [];
  if (profile.cpu) {
    const cpu = cpuShort(profile.cpu);
    const core = profile.cores ? `${profile.cores} 核${profile.threads ? ` ${profile.threads} 线程` : ''}` : '';
    parts.push(core ? `${cpu}（${core}）` : cpu);
  }
  if (profile.memoryGb) parts.push(`${Math.round(profile.memoryGb)}GB 内存`);
  if (profile.gpus.length) parts.push(profile.gpus[0]);
  if (profile.disks.length) {
    const disk = profile.disks
      .map(item => `${item.letter} 盘 ${item.totalGb}GB（剩 ${item.freeGb ?? '?'}GB）`)
      .join('、');
    parts.push(disk);
  }
  if (profile.screen) parts.push(`屏幕 ${profile.screen}`);
  if (profile.os) parts.push(profile.os.replace(/Microsoft\s*/, ''));
  return parts.join('，');
}

export async function readMachineProfile(stateDir) {
  try {
    const cached = JSON.parse(await readFile(join(stateDir, 'machine-profile.json'), 'utf8'));
    return sanitizeProfile(cached);
  } catch { return null; }
}

export async function collectMachineProfile({ stateDir, run = exec, platform = process.platform } = {}) {
  const cached = await readMachineProfile(stateDir);
  if (cached) return cached;
  if (platform !== 'win32') return null;
  try {
    const ps = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await run(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript()], { windowsHide: true, timeout: 20000, maxBuffer: 65536 });
    const profile = sanitizeProfile(JSON.parse(String(stdout ?? '').trim()));
    if (profile) {
      await mkdir(stateDir, { recursive: true }).catch(() => {});
      const path = join(stateDir, 'machine-profile.json');
      const temporary = path + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
      await rename(temporary, path);
    }
    return profile;
  } catch { return null; }
}
