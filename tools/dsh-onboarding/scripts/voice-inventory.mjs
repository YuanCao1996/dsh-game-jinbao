// 生成金宝话术总表：直接读各模块的台词表，输出 docs/VOICE_SCRIPT_INVENTORY.md
// 用法：node tools/dsh-onboarding/scripts/voice-inventory.mjs
// 改完台词（夸奖/选择反馈/人味句/锐评/威胁提醒/角色开场语）重跑本脚本即可同步文档。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const read = path => readFile(`${root}/tools/${path}`, 'utf8');
const NAMES = { jinbao: '金宝', liurufeng: '柳如风', wangbatian: '王霸天', tiezhi: '铁汁' };

// 解析「role: { ... },」这样的表格块
const blocks = (src, marker) => {
  const out = {};
  const body = src.slice(src.indexOf(marker));
  const re = /(\w+): \{\r?\n([\s\S]*?)\r?\n  \},/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
};
const arr = (body, key) => {
  const m = new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`).exec(body);
  return m ? [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]) : [];
};

const praiseSrc = await read('dsh-onboarding/multikill-praise.mjs');
const praise = {};
for (const [role, body] of Object.entries(blocks(praiseSrc, 'const VOICE = {'))) {
  praise[role] = {};
  for (const part of ['exclaim', 'react', 'praise', 'mock']) praise[role][part] = arr(body, part);
}

const choiceSrc = await read('dsh-onboarding/choice-reactions.mjs');
const choice = {};
for (const [role, body] of Object.entries(blocks(choiceSrc, 'const VOICES = {'))) {
  choice[role] = {};
  const re = /(agree|disagree|escalate): \{([\s\S]*?)\n    \},/g;
  let m;
  while ((m = re.exec(body))) choice[role][m[1]] = { item: arr(m[2], 'item'), augment: arr(m[2], 'augment') };
}

const humanSrc = await read('dsh-onboarding/human-moments.mjs');
const human = {};
for (const [role, body] of Object.entries(blocks(humanSrc, 'const VOICES = {'))) {
  human[role] = {};
  for (const slot of ['opening', 'death', 'endWin', 'endNeutral', 'endLoss', 'idle', 'streakEnded', 'pentaStolen', 'allyAfk', 'firstChampion', 'winStreak']) human[role][slot] = arr(body, slot);
}

const rolesSrc = await read('shared/game-roles.mjs');
const intros = [...rolesSrc.matchAll(/\{id:'(\w+)',name:'([^']+)'[^}]*intro:'([^']+)'/g)]
  .map(m => ({ id: m[1], name: m[2], intro: m[3] }));

const progressSrc = await read('dsh-onboarding/progress-events.mjs');
const threats = [...progressSrc.matchAll(/\{test:\/([^/]+)\/,line:hero=>([^}]+)\}/g)]
  .map(m => ({ match: m[1], line: m[2].trim() }));

const roastSrc = await read('dsh-onboarding/match-roast.mjs');
const roasts = [...roastSrc.matchAll(/`([^`]*[\u4e00-\u9fa5][^`]*)`/g)]
  .map(m => m[1]).filter(s => s.includes('${')).map(s => s.replace(/\s+/g, ' ').trim());

const countOf = table => Object.values(table).reduce((n, role) => n + Object.values(role)
  .reduce((k, value) => k + (Array.isArray(value) ? value.length : Object.values(value).reduce((a, b) => a + b.length, 0)), 0), 0);

const L = [];
L.push('# 金宝话术总表');
L.push('');
L.push('> 由 `tools/dsh-onboarding/scripts/voice-inventory.mjs` 从代码里直接抽取生成，改台词后重跑即可同步。');
L.push('> 「出声」= 会走语音；「上屏」= 只显示在悬浮窗/详情页/日志里。');
L.push('');
L.push('## 0. 概览');
L.push('');
L.push('| 类别 | 条数 | 触发时机 | 出声 |');
L.push('|---|---|---|---|');
L.push(`| 多杀夸奖 | ${countOf(praise)} 条零件，可拼约 2700 种/角色 | 你自己 2 杀起、队友 4/5 杀 | ✅ |`);
L.push(`| 选择反馈 | ${countOf(choice)} | 买完成装、选完海克斯 | ✅ |`);
L.push(`| 人味句 + 触发句 | ${countOf(human)} | 开局 / 阵亡 / 结束 / 沉默 / 连杀被终结 / 五杀被抢 / 队友挂机 / 首次上手 / 连胜 | ✅ |`);
L.push(`| 角色开场语 | ${intros.length} | 切换角色试听 | ✅ |`);
L.push(`| 敌方关键装提醒 | ${threats.length} | 敌方出了中娅/兰德里等 | ✅ |`);
L.push(`| 赛后锐评 | ${roasts.length} | 每局结束写进对局记录 | ❌ 仅上屏 |`);
L.push('| 推荐播报模板 | 4 种 | 出装 / 海克斯 / 选人建议 | ✅ |');
L.push('| 系统提示 | 3 种 | 阵容就位、榜单为空、建议过期 | ✅/上屏 |');
L.push('');
L.push('## 1. 多杀夸奖（出声）');
L.push('');
L.push('拼装：`叹词 + 你 + 多杀 + 反应 + 夸奖 + 被击杀者 + 幽默说法`');
L.push('');
for (const [role, name] of Object.entries(NAMES)) {
  const table = praise[role];
  if (!table) continue;
  L.push(`### ${name}`);
  L.push('');
  L.push('| 部分 | 内容 |');
  L.push('|---|---|');
  for (const [part, label] of [['exclaim', '叹词'], ['react', '反应'], ['praise', '夸奖'], ['mock', '幽默']]) {
    L.push(`| ${label}（${table[part].length}） | ${table[part].join(' / ')} |`);
  }
  L.push('');
}
L.push('队友模板（四杀/五杀）：`{叹词}，{英雄}这波{四杀/五杀}{反应}，{夸奖}。`');
L.push('');
L.push('被击杀者：1 人「对面的安妮」、2 人「对面的安妮和塞拉斯」、3 人以上「对面安妮、塞拉斯那几个」；复仇优先 →「塞拉斯那笔仇报了。」整句超 60 字时只保留前半段。');
L.push('');
L.push('## 2. 选择反馈（出声）');
L.push('');
L.push('触发：从背包差分发现买完成装，或读到 `augment_picked`；比对最近 5 条播报里的推荐，听劝就肯定、不听就调侃、连续不听升级。');
L.push('');
for (const [role, name] of Object.entries(NAMES)) {
  const table = choice[role];
  if (!table) continue;
  L.push(`### ${name}`);
  L.push('');
  L.push('| 结果 | 装备 | 海克斯 |');
  L.push('|---|---|---|');
  for (const [state, label] of [['agree', '听劝'], ['disagree', '不听'], ['escalate', '连续不听']]) {
    const slot = table[state];
    if (!slot) continue;
    L.push(`| ${label} | ${slot.item.join(' / ')} | ${slot.augment.join(' / ')} |`);
  }
  L.push('');
}
L.push('## 3. 人味句（出声）');
L.push('');
L.push('触发：每局开始、每次阵亡（≤3 次，间隔 ≥45 秒）、结束（胜/负/平）、超过 8 分钟没说话。');
L.push('');
for (const [role, name] of Object.entries(NAMES)) {
  const table = human[role];
  if (!table) continue;
  L.push(`### ${name}`);
  L.push('');
  L.push('| 场景 | 内容 |');
  L.push('|---|---|');
  for (const [slot, label] of [['opening', '开局'], ['death', '阵亡'], ['endWin', '赢了'], ['endNeutral', '结束'], ['endLoss', '输了'], ['idle', '长时间沉默'], ['streakEnded', '连杀被终结'], ['pentaStolen', '五杀被抢'], ['allyAfk', '队友挂机'], ['firstChampion', '首次上手'], ['winStreak', '连胜里程碑']]) {
    if (!table[slot]?.length) continue;
    L.push(`| ${label}（${table[slot].length}） | ${table[slot].join(' / ')} |`);
  }
  L.push('');
}
L.push('## 4. 角色开场语（出声）');
L.push('');
L.push('| 角色 | 台词 |');
L.push('|---|---|');
for (const item of intros) L.push(`| ${item.name} | ${item.intro} |`);
L.push('');
L.push('## 5. 敌方关键装提醒（出声）');
L.push('');
L.push('| 装备 | 台词 |');
L.push('|---|---|');
for (const item of threats) {
  const line = item.line.replace(/^hero\+'/, '').replace(/'$/, '').replace(/\$\{?hero\}?/g, '英雄');
  L.push(`| ${item.match} | ${line} |`);
}
L.push('');
L.push('## 6. 赛后锐评（只上屏）');
L.push('');
L.push(`按这局真实数据挑选，同一个 matchId 永远同一句。共 ${roasts.length} 条模板：`);
L.push('');
for (const text of roasts) L.push(`- \`${text}\``);
L.push('');
L.push('## 7. 推荐类播报模板（出声）');
L.push('');
L.push('| 场景 | 模板 |');
L.push('|---|---|');
L.push('| 出装建议精简 | `下一件 {装备}` |');
L.push('| 海克斯推荐 | `推荐选 {海克斯}（No.{排名} {梯队}）` |');
L.push('| 海克斯榜单 | `海克斯三选一 · {英雄}排名` |');
L.push('| 选人建议 | `选人建议 · {英雄}` + 分点 |');
L.push('| 建议过期 | `{原文}（稍早建议，局势已变化）` |');
L.push('| 阵容就位 | `阵容 · 我方 {N} 人已就位` |');
L.push('| 榜单为空 | `三个排名都在 30 名以外，建议刷新看看` / `三个都没进榜，建议刷新换一批` |');
L.push('');
L.push('## 8. 触发句的判定条件（2026-11-22 新增）');
L.push('');
L.push('| 场景 | 判定 | 节流 |');
L.push('|---|---|---|');
L.push('| 连杀被终结 | 自己连续击杀累计 ≥3 后阵亡 | 每次阵亡最多一条 |');
L.push('| 五杀被抢 | 队友拿到五杀，且自己这波已连杀 ≥3 | 每条事件一次 |');
L.push('| 队友挂机 | 队友等级与补刀连续 4 分钟都没变化（且未阵亡） | 每人每局一次 |');
L.push('| 首次上手 | 最近 20 局记录里没有这个英雄 | 每局一次 |');
L.push('| 连胜里程碑 | companion 里连胜 ≥3（跨对局持久化） | 每局一次 |');
L.push('');
L.push('## 9. 仍然没有话术的场景');
L.push('');
L.push('- 投降投票：客户端事件里没有 `Surrender`，做不了；');
L.push('- 段位晋级：拿不到段位数据，用「连胜里程碑」替代；');
L.push('- 游戏版本更新：只有应用自身版本号，没有 LoL 补丁号；');
L.push('- 拿龙 / 拆塔 / 破水晶：只有截图和事件记录，没有口头反馈；');
L.push('- 对线被单杀 3 次以上、被压 2 级：没有「要不要换线/求支援」的轻提示。');
L.push('');

await writeFile(`${root}/docs/VOICE_SCRIPT_INVENTORY.md`, `${L.join('\n')}\n`, 'utf8');
console.log(`已生成 docs/VOICE_SCRIPT_INVENTORY.md（${L.length} 行）`);
