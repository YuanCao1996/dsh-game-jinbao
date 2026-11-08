// 海克斯大乱斗（ARAM: Mayhem / 日志模式 KIWI）攻略要点。
// 设计原则：不进系统提示词全文——每局几十次调用都带着会既贵又稀释注意力。
// 这里只放「按阶段用得上」的短条目，由 buildLolCoachingPlan 按 stage 组装，
// 并且只在本局确实被判定为海克斯大乱斗时附加。
export const MAYHEM_CORE =
  '海克斯大乱斗＝随机英雄＋多轮海克斯三选一。固定决策顺序：先看阵容定位（缺前排/控制/持续输出），再看海克斯是否匹配英雄伤害方式，最后才看稀有度与胜率。海克斯会改写英雄定位和出装顺序，不能照搬普通大乱斗。';

const SECTIONS = {
  augment:
    '三选一先问三件事：① 和这个英雄的伤害方式匹配吗（技能/普攻/坦度）② 能补上当前阵容短板吗 ③ 触发条件稳定吗。稀有度≠适配度，棱彩不适配也可能不如适配的金色。三个都不完美时，选能立刻提升战斗力的那个，不要为了远期成型错过强势期。',
  build:
    '出装顺序：先定这一局主伤害来源（技能/普攻/持续作战）→ 核心装 → 鞋子（对面控制多，水银鞋提前）。海克斯已给暴击率就把暴击装往后放；海克斯给技能急速就先补法强或生存。装备榜是跨英雄平均，只用于看大方向，单英雄以英雄页为准。第四件起按「这局为什么打不赢」补穿透/保命/重伤/魔抗。购买多发生在阵亡回城，注意金币与阵亡窗口是否够。',
  opening:
    '开局先保证续航与清线，别一上来就追成装；第一波团以已有装备＋首个海克斯为轴打，血包等队友血量低时一起用。',
  teamfight:
    '团战：前排先站住、输出找安全位置、控制盯关键目标；强化再强也扛不住乱开团。对面坦克多补穿透、刺客多提前补保命、消耗多补回复或魔抗、己方缺前排适当补团队装。',
  map:
    '地图机制顺手拿：赛季音乐主题会给额外收益（集卡、属性锻造器、跳舞给全队金币、蜂蜜罐等），等于白给的强度。',
};

// 阶段 → 该看哪几条（返回空数组表示本阶段不需要附加）
const BY_STAGE = {
  augment: ['augment'],
  postAugment: ['augment', 'build'],
  opening: ['opening'],
  loading: ['opening'],
  early: ['opening'],
  equipment: ['build'],
  purchase: ['build'],
  death: ['build'],
  coordination: ['teamfight'],
  teamfight: ['teamfight'],
  ace: ['teamfight'],
  objective: ['teamfight'],
  situation: ['teamfight', 'build'],
  ultimate: [],
};

export function mayhemGuide(stage, sections = BY_STAGE) {
  const keys = sections[stage] ?? [];
  return keys.map(key => SECTIONS[key]).filter(Boolean);
}

export function mayhemGuideText(stage, sections) {
  const parts = mayhemGuide(stage, sections);
  return parts.length ? parts.join('\n') : '';
}

export const MAYHEM_SECTIONS = SECTIONS;
