// 播报里的人名校验：模型可以自由组织语言，但不能凭空捏造英雄、也不能把同一个英雄
// 写成两个名字（安妮 / 黑暗之女）后当成两个威胁。
//
// 真机事故：一局敌方名单是「解脱者、黑暗之女、祖安狂人、不屈之枪、河流之王」，
// 播报却写成「敌方安妮、乐芙兰、黑暗之女三法伤」——乐芙兰那局根本不存在，
// 安妮和黑暗之女还是同一个英雄。玩家一眼就看出来了。
//
// 这里提供两件事：
//   lineupOf(current)          → 本局双方名单（称号）
//   adviceNameIssues(text,列表) → 文本里越界的英雄名、以及同一英雄的重复命名

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// 称号→本名/别称的别名表：只用于「识别文本里提到了谁」，不用于展示。
const ALIASES = {
  黑暗之女: ['安妮', '火女'], 诡术妖姬: ['乐芙兰', '妖姬'], 暗夜猎手: ['薇恩'],
  迅捷斥候: ['提莫'], 祖安狂人: ['蒙多', '蒙多医生'], 法外狂徒: ['男枪', '格雷福斯'],
  诺克萨斯之手: ['诺手', '德莱厄斯'], 诺克萨斯统领: ['斯维因'], 复仇之矛: ['卡莉丝塔'],
  虚空恐惧: ['科加斯', '大虫子'], 河流之王: ['塔姆'], 九尾妖狐: ['阿狸', '狐狸'],
  冰霜女巫: ['丽桑卓', '冰女'], 爆破鬼才: ['吉格斯', '炸弹人'], 傲之追猎者: ['雷恩加尔', '狮子狗'],
  无极剑圣: ['剑圣', '易'], 蛮族之王: ['蛮王', '泰达米尔'], 熔岩巨兽: ['石头人', '墨菲特'],
  皮城女警: ['女警', '凯特琳'], 战争之影: ['赫卡里姆', '人马'], 虚空遁地兽: ['雷克塞', '挖掘机'],
  狂厄蔷薇: ['布蕾尔'], 虚空之眼: ['维克兹'], 未来守护者: ['杰斯'], 德玛西亚之力: ['盖伦'],
  狂战士: ['奥拉夫'], 不屈之枪: ['潘森'], 解脱者: ['塞拉斯'], 堕落天使: ['莫甘娜'],
  诡术妖姬: ['乐芙兰'], 时光守护者: ['基兰'], 海兽祭司: ['俄洛伊'], 刀锋之影: ['泰隆'],
  腕豪: ['瑟提'], 暗裔剑魔: ['亚托克斯'], 亡灵战神: ['赛恩'], 影流之主: ['劫'],
  疾风剑豪: ['亚索'], 卡牌大师: ['崔斯特'], 惩戒之箭: ['韦鲁斯'], 圣枪游侠: ['卢锡安'],
  涤魂圣枪: ['赛娜'], 含羞蓓蕾: ['莉莉娅'], 死亡颂唱者: ['卡尔萨斯'], 影流之镰: ['凯隐'],
  蜘蛛女皇: ['伊莉丝'], 机械公敌: ['兰博'], 未来战士: ['伊泽瑞尔'], 探险家: ['伊泽瑞尔'],
  复仇焰魂: ['布兰德'], 流浪法师: ['瑞兹'], 符文法师: ['瑞兹'],
};

// 称号表：用探索图鉴的名册（含全部 176 个称号），避免手写遗漏。
const TITLES = (() => {
  try {
    const path = fileURLToPath(new URL('../../dsh-onboarding/lol-roster.json', import.meta.url));
    return Object.keys(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return [];
  }
})();

const surfaceToTitle = new Map();
for (const title of TITLES) {
  surfaceToTitle.set(title, title);
  for (const alias of ALIASES[title] ?? []) surfaceToTitle.set(alias, title);
}
// 名册里没有、但别名表覆盖的称号也要能识别
for (const [title, aliases] of Object.entries(ALIASES)) {
  if (!surfaceToTitle.has(title)) surfaceToTitle.set(title, title);
  for (const alias of aliases) if (!surfaceToTitle.has(alias)) surfaceToTitle.set(alias, title);
}

const surfaces = [...surfaceToTitle.keys()].sort((a, b) => b.length - a.length);

const toList = value => Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
const nameOf = person => typeof person === 'string' ? person : String(person?.champion ?? person?.name ?? '');

export function lineupOf(current) {
  const self = String(current?.me?.champion ?? current?.selfChampion ?? '').trim();
  const allies = toList(current?.allies).map(nameOf).map(s => s.trim()).filter(Boolean);
  const enemies = toList(current?.enemies).map(nameOf).map(s => s.trim()).filter(Boolean);
  const all = [...new Set([self, ...allies, ...enemies].filter(Boolean))];
  return { self, allies, enemies, all };
}

// 文本里出现的英雄：返回 [{ title, surface }]，保留原文写法便于报错。
export function namesInText(text) {
  const source = String(text ?? '');
  const found = new Map();
  for (const surface of surfaces) {
    let index = source.indexOf(surface);
    while (index >= 0) {
      const title = surfaceToTitle.get(surface) ?? surface;
      if (!found.has(title)) found.set(title, new Set());
      found.get(title).add(surface);
      index = source.indexOf(surface, index + surface.length);
    }
  }
  return [...found].map(([title, set]) => ({ title, surfaces: [...set] }));
}

// 越界英雄名 + 同一英雄被写成多个名字。
export function adviceNameIssues(text, lineup) {
  const allowed = new Set(
    Array.isArray(lineup?.all) && lineup.all.length
      ? lineup.all
      : [lineup?.self, ...toList(lineup?.allies).map(nameOf), ...toList(lineup?.enemies).map(nameOf)].map(s => String(s ?? '').trim()).filter(Boolean)
  );
  const found = namesInText(text);
  const unknown = found.filter(item => !allowed.has(item.title)).map(item => item.title);
  // 同一个英雄出现两种以上写法（称号 + 本名）→ 会被当成两个英雄
  const aliased = found
    .map(item => ({ title: item.title, surfaces: item.surfaces }))
    .filter(item => item.surfaces.length > 1)
    .map(item => ({ title: item.title, surfaces: item.surfaces }));
  return { unknown: [...new Set(unknown)], aliased, found: found.map(item => item.title) };
}

export function describeIssues(issues) {
  const parts = [];
  if (issues?.unknown?.length) parts.push('名单外英雄: ' + issues.unknown.join('、'));
  if (issues?.aliased?.length) parts.push('同一英雄多种写法: ' + issues.aliased.map(item => `${item.title}(${item.surfaces.join('/')})`).join('；'));
  return parts.join(' | ');
}

export const _internal = { TITLES, ALIASES };
