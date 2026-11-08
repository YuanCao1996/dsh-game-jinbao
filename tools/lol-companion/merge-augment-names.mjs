// 把服务器权威索引（kiwi-augments.json，237 条）合并进本地词表，
// 剔除会被 OCR 当成卡名的类别标签（重型/力量/鞭挞/厄运…）。
// 背景：开局三选一里「吸元秘术」「深红钴蓝闪光」「鼓声暴起 低音轰鸣」都在服务器索引里，
// 但本地词表没有 → 三张卡只认出 1 张 → 不满足“至少 2 张不同卡”的条件 → 整块面板被丢弃。
import { readFileSync, writeFileSync } from 'node:fs';

const localPath = 'tools/lol-companion/augment-names.json';
const serverPath = process.argv[2];
if (!serverPath) {
  console.error('usage: node merge-augment-names.mjs <server-names.json>');
  process.exit(1);
}
// 卡面下方的类别标签；进了词表就会被当成卡名（曾经把「装备」塞进三选一）。
const LABELS = new Set(['重型', '力量', '速度', '功能', '复原力', '伤害', '法术', '生命', '攻击', '防御',
  '综合', '辅助', '护盾', '冷却', '暴击', '移动', '韧性', '鞭挞', '护甲', '魔抗', '金币', '治疗',
  '减速', '加速', '持续', '叠加', '装备', '物品', '商店', '属性', '符文', '天赋', '技能',
  '召唤师', '回城', '购买', '出售', '面板', '详情', '关闭', '选择', '强化', '任务']);

const local = JSON.parse(readFileSync(localPath, 'utf8'));
const server = JSON.parse(readFileSync(serverPath, 'utf8'));
const before = local.length;

const merged = [...new Set([...local, ...server])]
  .map((name) => String(name ?? '').trim())
  .filter((name) => name.length >= 2 && !LABELS.has(name))
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

const added = merged.filter((name) => !local.includes(name));
const dropped = local.filter((name) => !merged.includes(name));
writeFileSync(localPath, JSON.stringify(merged, null, 0) + '\n', 'utf8');
console.log(JSON.stringify({
  before, after: merged.length, added: added.length, dropped: dropped.length,
  addedNames: added, droppedNames: dropped,
}, null, 1));
