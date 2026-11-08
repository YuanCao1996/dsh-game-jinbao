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
const PY = String.raw`
import ast, glob, json, os, sys
from collections import Counter

def load(path):
    out = []
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out

def data_of(row):
    raw = row.get('data')
    if isinstance(raw, dict):
        return raw
    try:
        return ast.literal_eval(raw)
    except Exception:
        return {}

def text_of(message):
    parts = []
    for block in message.get('content') or []:
        if isinstance(block, dict) and block.get('type') == 'text':
            parts.append(str(block.get('text') or ''))
    return ''.join(parts)

from_ms, to_ms = float(sys.argv[1]), float(sys.argv[2])
root = sys.argv[3]
files = []
for path in glob.glob(root + '/*/*/_no-cwd/*/session.v4.jsonl'):
    mtime = os.path.getmtime(path) * 1000
    if from_ms <= mtime <= to_ms:
        files.append((mtime, path))
files.sort()

print('')
print('-- DSH session（服务器）--')
print('命中会话 %d 个' % len(files))
tool_ok, tool_bad = Counter(), Counter()
slow = []
sessions = []
for mtime, path in files:
    rows = load(path)
    if not rows:
        continue
    sid = os.path.basename(os.path.dirname(path))
    created = None
    calls = {}
    steps = 0
    answer = ''
    failed_tools = []
    for row in rows:
        kind = row.get('type')
        payload = data_of(row)
        if kind == 'session':
            created = int(row.get('createdAt') or 0)
        elif kind == 'step/start':
            steps += 1
        elif kind == 'tool/call':
            calls[payload.get('callId')] = {'name': payload.get('name'), 'name_at': int(row.get('time') or 0)}
        elif kind == 'tool/result':
            call_id = payload.get('toolCallId') or (payload.get('message') or {}).get('toolCallId')
            info = calls.get(call_id) or {}
            name = info.get('name') or '?'
            message = payload.get('message') or {}
            text = text_of(message)
            low = text.lower()
            bad = False
            for marker in ('"ok":false', '"success":false', 'unavailable', '[tool error'):
                if marker in low:
                    bad = True
            if bad:
                tool_bad[name] += 1
                failed_tools.append(name)
                head = text.replace('\n', ' ')[:70]
            else:
                tool_ok[name] += 1
            if info.get('name_at'):
                slow.append((int(row.get('time') or 0) - info['name_at'], name))
        elif kind == 'assistant/message':
            message = payload.get('message') or {}
            text = text_of(message)
            if text.strip():
                answer = text.strip()
    sessions.append({'id': sid, 'steps': steps, 'answer': answer, 'at': created or int(mtime), 'tools': len(calls), 'failed': failed_tools})

for item in sorted(sessions, key=lambda x: x['at']):
    stamp = __import__('datetime').datetime.fromtimestamp(item['at'] / 1000).strftime('%H:%M:%S')
    tail = item['answer'].replace('\n', ' ')[:90]
    mark = (' 失败:' + ','.join(item['failed'])) if item['failed'] else ''
    print('  %s %s 步=%d 工具=%d%s' % (stamp, item['id'][:8], item['steps'], item['tools'], mark))
    if tail:
        print('        回答: ' + tail)

print('')
print('-- 工具调用合计 --')
print('  成功:', dict(tool_ok) or '无')
print('  失败:', dict(tool_bad) or '无')
slow.sort(reverse=True)
for spent, name in slow[:5]:
    print('  慢: %s %dms' % (name, spent))
`;

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
