// 从 CDragon 当前版本的强化词表补齐本地识别目录。
// 背景：本地 augment-names.json 长期手维护，0.3.22 实测 11 张候选里 2 张未收录
// （过量延伸者等），导致卡牌无法上榜、还会误报"建议刷新"。
// 用法：node tools/lol-companion/sync-augment-names.mjs [cdragon-cherry-augments.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const CDRAGON_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/cherry-augments.json';
const localPath = fileURLToPath(new URL('./augment-names.json', import.meta.url));
const LABELS = new Set(['重型', '力量', '速度', '功能', '复原力', '伤害', '法术', '生命', '攻击', '防御',
  '综合', '辅助', '护盾', '冷却', '暴击', '移动', '韧性', '鞭挞', '护甲', '魔抗', '金币', '治疗',
  '减速', '加速', '持续', '叠加', '装备', '物品', '商店', '属性', '符文', '天赋', '技能',
  '召唤师', '回城', '购买', '出售', '面板', '详情', '关闭', '选择', '强化', '任务']);

const inputPath = process.argv[2];
const rows = inputPath
  ? JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\ufeff/, ''))
  : await (await fetch(CDRAGON_URL, {signal: AbortSignal.timeout(30000)})).json();
const local = JSON.parse(readFileSync(localPath, 'utf8').replace(/^\ufeff/, ''));
const remote = rows
  .map((row) => String(row?.nameTRA ?? row?.name ?? '').trim())
  .filter((name) => name.length >= 2 && /^[\u4e00-\u9fa5]/.test(name) && !/[?？]/.test(name) && !LABELS.has(name));
const merged = [...new Set([...local, ...remote])].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
writeFileSync(localPath, JSON.stringify(merged, null, 0) + '\n', 'utf8');
console.log(JSON.stringify({
  before: local.length,
  cdragonRows: rows.length,
  cdragonNames: remote.length,
  after: merged.length,
  added: merged.filter((name) => !local.includes(name)).length,
  sampleAdded: merged.filter((name) => !local.includes(name)).slice(0, 12),
  hasOverextender: merged.includes('过量延伸者'),
}));
