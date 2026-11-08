// 单局复盘：本地智能体动态时间线 + 服务器上的 DSH session 文件。
//
// 用法：
//   node handoff/analyze-session.mjs                  # 复盘最近一局
//   node handoff/analyze-session.mjs --match <id>     # 指定对局（如 lol-live-1794139490628.jsonl#1）
//   node handoff/analyze-session.mjs --pull <dir>     # 顺便把 session 文件原样拉到本地
//
// session 文件在服务器上每回合一个：state-dsh/data/<owner>/<sessionId>/_no-cwd/<sessionId>/session.v4.jsonl
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const activityPath = join(homedir(), '.jinbao-cloud-preview', 'logs', 'agent-activity.jsonl');
const all = readFileSync(activityPath, 'utf8').split('\n').filter(Boolean)
  .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

const rows = all.filter(row => row.kind === 'row' && row.match);
const target = flag('--match') ?? rows.at(-1)?.match;
if (!target) { console.error('没有可用对局记录'); process.exit(1); }

const mine = rows.filter(row => row.match === target);
if (!mine.length) { console.error('该对局没有动态记录：' + target); process.exit(1); }

const from = Math.min(...mine.map(row => row.at)) - 60000;
const to = Math.max(...mine.map(row => row.at)) + 60000;

// ---------- 本地部分 ----------
const tasks = new Map();
for (const row of mine) {
  const task = tasks.get(row.task) ?? { id: row.task, topic: row.topic, steps: [], start: row.at, end: row.at };
  tasks.set(row.task, task);
  task.steps.push(row);
  task.end = Math.max(task.end, row.at);
}

const seconds = ms => Math.round(ms / 100) / 10;
const failures = mine.filter(row => ['failed', 'unavailable', 'interrupted'].includes(row.phase));

console.log(`=== 复盘 ${target} ===`);
console.log(`动态记录 ${mine.length} 条 · 任务 ${tasks.size} 个 · 窗口 ${new Date(from).toLocaleTimeString('zh-CN')}~${new Date(to).toLocaleTimeString('zh-CN')}`);
console.log('\n-- 任务耗时 --');
for (const task of [...tasks.values()].sort((a, b) => a.start - b.start)) {
  const states = {};
  for (const step of task.steps) states[step.phase] = (states[step.phase] ?? 0) + 1;
  console.log(`  ${task.topic} ${seconds(task.end - task.start)}s · ${task.steps.length} 步 · ` +
    Object.entries(states).map(([key, count]) => `${key}:${count}`).join(' '));
}
if (failures.length) {
  console.log('\n-- 异常步骤 --');
  for (const row of failures.slice(0, 12)) console.log(`  ${row.clock} ${row.topic} · ${row.label} · ${row.phase}`);
}

// ---------- 服务器部分 ----------
const PY = readFileSync(new URL('./session-analyze.py', import.meta.url), 'utf8');

const remote = `python3 /tmp/dsh-session-analyze.py ${from} ${to} /var/lib/jinbao-desktop-deploy/cloud-dsh-poc-20261024/state-dsh/data`;
const encoded = Buffer.from(`${PY}\n`, 'utf8').toString('base64');
const ssh = `echo ${encoded} | base64 -d > /tmp/dsh-session-analyze.py && ${remote}`;
const command = `ssh -i ~/.ssh/jinbao.pem -o StrictHostKeyChecking=no root@123.57.130.211 '${ssh.replace(/'/g, `'\\''`)}'`;

try {
  const output = execFileSync('wsl.exe', ['-e', 'bash', '-lc', command], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  console.log(output.trimEnd());
} catch (error) {
  console.error('拉取 session 失败：' + (error.stderr || error.message));
  process.exit(2);
}

const pull = flag('--pull');
if (pull) {
  const tarCommand = `find /var/lib/jinbao-desktop-deploy/cloud-dsh-poc-20261024/state-dsh/data -name session.v4.jsonl -newermt '@${Math.floor(from / 1000)}' ! -newermt '@${Math.ceil(to / 1000)}' -print0 | tar -czf - --null -T -`;
  try {
    const buffer = execFileSync('wsl.exe', ['-e', 'bash', '-lc',
      `ssh -i ~/.ssh/jinbao.pem -o StrictHostKeyChecking=no root@123.57.130.211 '${tarCommand}' > /tmp/dsh-sessions.tgz && echo /tmp/dsh-sessions.tgz`],
      { maxBuffer: 256 * 1024 * 1024 });
    const wslPath = String(buffer).trim().split('\n').at(-1);
    const winPath = execFileSync('wsl.exe', ['-e', 'wslpath', '-w', wslPath], { encoding: 'utf8' }).trim();
    execFileSync('tar', ['-xzf', winPath, '-C', pull], { stdio: 'inherit' });
    console.log('\nsession 原始文件已解到 ' + pull);
  } catch (error) {
    console.error('拉取原始文件失败：' + (error.stderr || error.message));
  }
}
