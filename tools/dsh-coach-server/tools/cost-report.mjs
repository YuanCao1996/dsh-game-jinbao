// Read-only cost report for the coach: how many model turns a session/match really took,
// how long they took, and what a goal-mode match would cost at a given round budget.
//
// Usage: node tools/dsh-coach-server/tools/cost-report.mjs [stateDir] [--rounds 40]
// stateDir defaults to %USERPROFILE%\.jinbao-cloud-preview (standalone line).

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const roundsArg = args.includes('--rounds') ? Number(args[args.indexOf('--rounds') + 1]) : 40;
const stateDir = args.find(a => !a.startsWith('--') && !Number.isFinite(Number(a))) ?? join(homedir(), '.jinbao-cloud-preview');

const clamp = value => Math.max(0, Math.min(1e9, Math.round(value)));

function readJsonl(file) {
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* ignore torn tail */ }
  }
  return rows;
}

function listEventFiles(dir) {
  try {
    return readdirSync(dir).filter(n => /^events-\d+\.jsonl$/.test(n)).sort()
      .map(n => join(dir, n));
  } catch {
    return [];
  }
}

const diagnostics = join(stateDir, 'diagnostics');
const sessions = [];
if (existsSync(diagnostics)) {
  for (const name of readdirSync(diagnostics)) {
    const dir = join(diagnostics, name);
    if (!statSync(dir).isDirectory()) continue;
    const events = listEventFiles(dir).flatMap(readJsonl);
    if (!events.length) continue;
    const started = events.filter(e => e.event === 'agent' && e.action === 'task_started');
    const done = events.filter(e => e.event === 'agent' && e.action === 'task_completed');
    const byTopic = {};
    for (const row of started) byTopic[row.topic ?? '?'] = (byTopic[row.topic ?? '?'] ?? 0) + 1;
    const matches = new Set(started.map(r => r.matchId).filter(Boolean));
    const first = events[0]?.at ?? 0;
    const last = events.at(-1)?.at ?? first;
    const latencies = done.map(r => Number(r.elapsedMs)).filter(Number.isFinite);
    sessions.push({
      name: name.slice(0, 19),
      minutes: clamp((last - first) / 60000),
      turns: started.length,
      matches: matches.size,
      byTopic,
      avgMs: latencies.length ? clamp(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      maxMs: latencies.length ? clamp(Math.max(...latencies)) : null,
    });
  }
}

console.log(`状态目录: ${stateDir}`);
console.log(`诊断会话: ${sessions.length}\n`);
if (sessions.length) {
  console.log('会话              时长   回合  对局  建议/装备/聊天        平均耗时  最长');
  for (const s of sessions) {
    const topics = ['advice', 'equipment', 'chat'].map(t => s.byTopic[t] ?? 0).join('/');
    console.log(
      `${s.name.padEnd(20)}${String(s.minutes).padStart(4)}分${String(s.turns).padStart(5)}${String(s.matches).padStart(6)}  ` +
      `${topics.padEnd(20)}${String(s.avgMs ?? '-').padStart(8)}ms${String(s.maxMs ?? '-').padStart(7)}ms`);
  }
}

const totalTurns = sessions.reduce((sum, s) => sum + s.turns, 0);
const totalMatches = sessions.reduce((sum, s) => sum + s.matches, 0);
const avgTurnsPerMatch = totalMatches ? totalTurns / totalMatches : 0;
console.log(`\n合计回合 ${totalTurns}，覆盖对局 ${totalMatches}，平均每局 ${avgTurnsPerMatch.toFixed(1)} 回合`);

// Bytes per request: the model proxy keeps only the newest sample, so treat it as an
// order-of-magnitude figure rather than a measured average.
let bytes = null;
const proxyFile = join(stateDir, 'model-proxy-diagnostics.json');
if (existsSync(proxyFile)) {
  try { bytes = Number(JSON.parse(readFileSync(proxyFile, 'utf8')).bytes) || null; } catch { /* ignore */ }
}
console.log(`\n单次请求体量（仅最新样本）: ${bytes === null ? '无样本' : clamp(bytes / 1024) + ' KB'}`);

console.log(`\n常驻目标模式预估（本局按 ${roundsArg} 轮上限）:`);
console.log(`  每局回合上限        ${roundsArg}`);
console.log(`  事件驱动实测每局     ${avgTurnsPerMatch.toFixed(1)} 回合`);
if (bytes !== null) {
  const mb = clamp((bytes * roundsArg) / 1048576 * 10) / 10;
  console.log(`  目标模式上行体量上限 ${mb} MB（${roundsArg} × ${clamp(bytes / 1024)} KB，未计输出）`);
}
console.log('  说明: 上行体量只是输入侧；输出与工具轮次会额外计算。实际额度以云端结算为准。');
