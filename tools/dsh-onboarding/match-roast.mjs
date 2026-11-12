// 每局打完的「锐评」：只根据这局真实记录的事实说话，不编数据。
//
// 三条原则：
// 1. 有料 —— 必须带一个具体数字（参与率、补刀、推塔、多杀次数），不能只是嘴贫。
// 2. 有梗 —— 用玩家熟悉的说法（人机、挂机、血压、抽象、典、破防、科研），但目标是「好笑」不是「扎心」。
// 3. 不骂人 —— 只调侃本局的表现与操作风格，不提任何玩家 ID，不做人身攻击；
//    输的局把它说成「这局打得像在给对方做新手教学」，而不是「你菜」。
//
// 同一个 matchId 永远得到同一句，避免刷新一次换一句话显得不认真。

import {contextComments} from './match-context.mjs';

const HASH = value => {
  let h = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};
const pick = (list, seed) => list[HASH(seed) % list.length];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// 参与率在不同版本的记录里既有 0~1 小数也有 0~100 整数，统一按「<=1 视为比例」处理，
// 否则同一条数据可能被显示成 1% 或 100%。
const pct = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v <= 1 ? v * 100 : Math.min(v, 100));
};

function stats(memory) {
  const kda = Array.isArray(memory?.kda) ? memory.kda.map(Number) : null;
  const [k, d, a] = kda ?? [null, null, null];
  const minutes = Number(memory?.durationSeconds) > 0 ? Number(memory.durationSeconds) / 60 : null;
  const teamKills = Number(memory?.teamKills);
  const involvement = Number.isFinite(k) && Number.isFinite(a) && Number.isFinite(teamKills) && teamKills > 0
    ? (k + a) / teamKills
    : null;
  const cs = Number(memory?.cs);
  const csPerMin = Number.isFinite(cs) && minutes ? cs / minutes : null;
  return {
    k, d, a, minutes,
    win: memory?.win === true ? true : memory?.win === false ? false : null,
    involvement,
    cs: Number.isFinite(cs) ? cs : null,
    csPerMin,
    turrets: Number(memory?.turrets) || 0,
    inhibs: Number(memory?.inhibs) || 0,
    firstBlood: memory?.firstBlood === true,
    multikillMax: Number(memory?.multikillMax) || 0,
    aceFor: Number(memory?.aceFor) || 0,
    aceAgainst: Number(memory?.aceAgainst) || 0,
    deaths: d,
    kills: k,
  };
}

const label = s => {
  if (s.multikillMax >= 5) return '五杀';
  if (s.multikillMax === 4) return '四杀';
  if (s.multikillMax === 3) return '三杀';
  return null;
};

// ---- 分类：按优先级匹配，第一个命中的成为主评 ----
function classify(s) {
  const tags = [];
  if (s.win === true && s.deaths === 0) tags.push('noDeath');
  if (s.kills >= 20) tags.push('slayer');
  if (s.multikillMax >= 5) tags.push('penta');
  if (s.involvement !== null && s.involvement >= 0.6 && s.kills >= 5) tags.push('carry');
  if (s.deaths >= 10 && (s.involvement === null || s.involvement < 0.5)) tags.push('freeRealEstate');
  if (s.involvement !== null && s.involvement < 0.35 && s.minutes >= 10) tags.push('spectator');
  if (s.csPerMin !== null && s.csPerMin < 2.5 && s.minutes >= 10) tags.push('wanderer');
  if (s.csPerMin !== null && s.csPerMin > 8) tags.push('farmer');
  if (s.turrets >= 3) tags.push('demolition');
  if (s.aceFor >= 2) tags.push('aceMachine');
  if (s.aceAgainst >= 2) tags.push('aceFodder');
  if (s.firstBlood) tags.push('firstBlood');
  if (s.minutes !== null && s.minutes < 10) tags.push('speedrun');
  if (s.minutes !== null && s.minutes >= 28) tags.push('endurance');
  if (s.win === false && s.kills >= 10) tags.push('goodTry');
  if (s.win === true && s.kills <= 2) tags.push('escort');
  return tags;
}

const TEMPLATES = {
  noDeath: [
    s => `零死亡，${s.kills}/${s.a}。这局你不是在打对局，是在做示范动作。`,
    s => `一次都没死，参与率 ${pct(s.involvement ?? 0)}%，对面打你像在打卡上班。`,
  ],
  slayer: [
    s => `${s.kills} 杀，这不是对局，这是你家开的射击场。`,
    s => `${s.kills} 杀 ${s.a} 助，对面五个人的共同点是都见过你的技能特效。`,
  ],
  penta: [
    () => '五杀。截图存好了吗，不存就白拿了。',
    s => `五杀 + ${s.kills} 杀，队友这局主要负责鼓掌。`,
  ],
  carry: [
    s => `参与率 ${pct(s.involvement)}%，全队一半以上的击杀你在场。这局你是那个「人」。`,
    s => `全队 ${s.kills + s.a} 次进场你都在，队友只要负责不死就行。`,
  ],
  freeRealEstate: [
    s => `${s.deaths} 次阵亡，参与率 ${pct(s.involvement ?? 0)}%。你这不是送，你是在做地标建筑。`,
    s => `死了 ${s.deaths} 次。对面经济起飞有你一份原始股。`,
  ],
  spectator: [
    s => `参与率 ${pct(s.involvement)}%——大部分团战你在场，但没进场。这局你更像观赛嘉宾。`,
    s => `全队 ${s.kills + s.a} 次参与里只有 ${pct(s.involvement)}% 有你，你是这条线的形象代言人。`,
  ],
  wanderer: [
    s => `${s.cs} 刀 / ${Math.round(s.minutes)} 分钟，每分钟 ${s.csPerMin.toFixed(1)}。兵线对你来说只是背景板。`,
    s => `补刀 ${s.cs}，平均每分钟 ${s.csPerMin.toFixed(1)}。你在打团战，不是打补刀，能理解。`,
  ],
  farmer: [
    s => `每分钟 ${s.csPerMin.toFixed(1)} 刀，${s.cs} 刀全场。你把召唤师峡谷当地产在经营。`,
    s => `补刀 ${s.cs}（${s.csPerMin.toFixed(1)}/分），这局你的敌人是兵线，而且你赢了。`,
  ],
  demolition: [
    s => `推了 ${s.turrets} 座塔。这局你玩的是拆迁模拟器，对手是物业。`,
    s => `${s.turrets} 座塔 + ${s.inhibs} 个水晶，地图是被你一个人改写的。`,
  ],
  aceMachine: [
    s => `对面被团灭 ${s.aceFor} 次。这不是对局，这是循环播放。`,
    s => `团灭对面 ${s.aceFor} 次，对面复活倒计时都比对局时间长。`,
  ],
  aceFodder: [
    s => `我方被团灭 ${s.aceAgainst} 次。团战打得很有节奏感，很有规律的节奏感。`,
    s => `被团灭 ${s.aceAgainst} 次，队友死得有组织有纪律。`,
  ],
  firstBlood: [
    s => `一血开张。开局那一下很凶，后面 ${s.kills}/${s.deaths}/${s.a} 就随便了。`,
    s => `拿到一血，说明开局思路对；后面打成 ${s.kills}/${s.deaths} 说明只对了开局。`,
  ],
  speedrun: [
    s => `${Math.round(s.minutes)} 分钟结束。这局节奏比加载画面还短。`,
    s => `${Math.round(s.minutes)} 分钟打完，属于速通组，建议申报纪录。`,
  ],
  endurance: [
    s => `${Math.round(s.minutes)} 分钟。这已经不是对局，是耐力赛，建议配补给。`,
    s => `${Math.round(s.minutes)} 分钟磨下来，你的膀胱为这局付出了真实代价。`,
  ],
  goodTry: [
    s => `${s.kills} 杀还是输了。数据很漂亮，结局很现实主义。`,
    s => `${s.kills}/${s.deaths}/${s.a} 输掉。这局的悲剧在于你很努力，队友也很努力地不努力。`,
  ],
  escort: [
    s => `${s.kills} 杀赢下来，属于躺得比较有技术含量的一种赢。`,
    s => `赢了，${s.kills} 杀。这局你的主要贡献是不给队友添麻烦。`,
  ],
};

const FALLBACK = [
  s => `${s.kills}/${s.deaths}/${s.a}，${s.win === true ? '赢了' : s.win === false ? '输了' : '打完了'}。下一局见。`,
  s => `这局记下了：${s.kills}/${s.deaths}/${s.a}，${Math.round(s.minutes ?? 0)} 分钟。`,
];

const TAILS = [
  '下一局要不要换个思路？',
  '记一笔，下把看变化。',
  '这局的数据我留着，下次对比。',
];

export function roastMatch(memory, options = {}) {
  if (!memory || !Array.isArray(memory.kda)) return '';
  const s = stats(memory);
  const tags = classify(s);
  const seed = String(memory.id ?? '') + ':' + (memory.endedAt ?? '');
  const primary = tags.find(tag => TEMPLATES[tag]);
  const body = primary ? pick(TEMPLATES[primary], seed) : pick(FALLBACK, seed + ':fb');
  let text = typeof body === 'function' ? body(s) : body;
  // 成就向：破纪录时补一句，这部分是「有料」的另一半。
  if (options.personalBest && !options.quiet && options.personalBest.firstTime !== true) {
    const parts = [];
    if (options.personalBest.bestKills) parts.push(`击杀破纪录（${options.personalBest.bestKills}）`);
    if (options.personalBest.bestInvolvement) parts.push(`参与率新高（${pct(options.personalBest.bestInvolvement)}）`);
    if (options.personalBest.longestMultikill) parts.push(`${label({ multikillMax: options.personalBest.longestMultikill })}纪录`);
    if (parts.length) text += ' ' + parts.join(' · ') + '。';
  }
  // 上下文评语：英雄定位、海克斯、出装与强化是否对上。
  const context = options.context === false ? [] : contextComments(memory, s, options.profile);
  if (context.length) text += ' ' + context[0];
  if (context.length > 1) text += ' ' + context[1];
  const tail = options.tail === false ? '' : ' ' + pick(TAILS, seed + ':tail');
  return (text + tail).trim();
}

export const _internal = { stats, classify, pct };
