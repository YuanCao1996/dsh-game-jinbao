// 从 CDragon 当前版本的装备表生成本地装备名白名单。
// 播报里模型偶尔会把「狂战士胫甲」写成不存在的「奥拉夫胫甲」；播报出口用它做
// 形近名纠正/拦截，避免把不存在的装备念给玩家。
// 用法：node tools/lol-companion/sync-item-names.mjs [cdragon-items-zh.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const CDRAGON_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/items.json';
const localPath = fileURLToPath(new URL('./item-names.json', import.meta.url));
const inputPath = process.argv[2];
const rows = inputPath
  ? JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\ufeff/, ''))
  : await (await fetch(CDRAGON_URL, {signal: AbortSignal.timeout(30000)})).json();
const names = [...new Set(rows.map((row) => String(row?.name ?? '').trim())
  .filter((name) => name && /^[\u4e00-\u9fa5]/.test(name)))]
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
writeFileSync(localPath, JSON.stringify(names, null, 0) + '\n', 'utf8');
console.log(JSON.stringify({rows: rows.length, names: names.length, sample: names.slice(0, 8), hasBerserkerGreaves: names.includes('狂战士胫甲')}));
