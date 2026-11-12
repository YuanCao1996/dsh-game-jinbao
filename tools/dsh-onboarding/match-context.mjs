// 锐评需要「上下文」：英雄称号、定位、海克斯、出装、召唤师技能。
// 这里把上下文变成额外的评语素材，仍然只依据记录里的事实。

const ROLE_ZH = {
  Fighter: '战士', Tank: '坦克', Mage: '法师', Assassin: '刺客',
  Marksman: '射手', Support: '辅助', Artillery: '炮台法师',
};

// 强化点名的装备：与出装不一致时可以调侃（数据来自项目内已确认的四类）。
const AUGMENT_ITEM = [
  { augment: '钢化你心', item: '心之钢', hint: '心之钢' },
  { augment: '命运之武器', item: null, hint: '传说装备' },
];

const has = (list, name) => Array.isArray(list) && list.some(x => String(x).includes(name));
const asPct = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v <= 1 ? v * 100 : Math.min(v, 100));
};

function profileLine(s, memory, profile) {
  if (!profile) return null;
  const roles = Array.isArray(profile.roles) ? profile.roles.map(r => ROLE_ZH[r] ?? r) : [];
  const roleText = roles.length ? roles.slice(0, 2).join('/') : null;
  const tankish = roles.some(r => ['Tank', 'Fighter'].includes(r));
  const squishy = roles.some(r => ['Mage', 'Marksman', 'Assassin', 'Support', 'Artillery'].includes(r));

  // 定位与数据错位，是最有料的素材。
  if (tankish && s.kills >= 12) return `你拿的是${roleText}，打的却是刺客数据：${s.kills} 杀。这局队里既没有前排也没有后排，只有你。`;
  if (tankish && s.deaths >= 10) return `${roleText}，死了 ${s.deaths} 次。前排的意思是该倒的时候倒，不是一直倒。`;
  if (squishy && s.deaths >= 10) return `脆皮${roleText}死了 ${s.deaths} 次，站位这件事你打算什么时候开始考虑。`;
  if (profile.engage === true && s.involvement !== null && asPct(s.involvement) >= 55) return `全队唯一开团点（${roleText}），参与率 ${asPct(s.involvement)}%：这局所有团都从你身上开始。`;
  if (profile.engage === true && s.involvement !== null && asPct(s.involvement) < 35) return `你是全队唯一的开团点，参与率却只有 ${asPct(s.involvement)}%。团战开始的时候你人在哪。`;
  if (roleText) return `${roleText}定位，${s.kills}/${s.deaths}/${s.a}。`;
  return null;
}

function itemLine(s, memory) {
  const items = Array.isArray(memory.items) ? memory.items : [];
  if (!items.length) return null;
  const augments = Array.isArray(memory.augments) ? memory.augments : [];

  // 拿了点名装备的强化，却没做那件装备：最实用的吐槽。
  for (const rule of AUGMENT_ITEM) {
    if (!has(augments, rule.augment)) continue;
    if (rule.item && has(items, rule.item)) {
      return `${rule.augment}配上了${rule.item}，这局强化是真的吃到了。`;
    }
    if (rule.item && !has(items, rule.item)) {
      return `你拿了${rule.augment}，但六件里没有${rule.item}——这个强化在你包里睡觉。`;
    }
  }
  if (items.length >= 6) return `六件成装：${items.slice(0, 4).join('、')}${items.length > 4 ? '…' : ''}。装备是齐的，问题不在格子。`;
  if (items.length <= 2 && s.minutes && s.minutes >= 15) return `打了 ${Math.round(s.minutes)} 分钟只有 ${items.length} 件成装，经济去哪了。`;
  return null;
}

export function contextComments(memory, s, profile) {
  const out = [];
  const augments = Array.isArray(memory?.augments) ? memory.augments : [];
  if (augments.length) {
    const names = augments.slice(0, 3).join('、');
    out.push(`这局的海克斯是${names}${augments.length > 3 ? ' 等' : ''}。`);
  }
  const p = profileLine(s, memory, profile);
  if (p) out.push(p);
  const i = itemLine(s, memory);
  if (i) out.push(i);
  return out.filter(Boolean);
}

export { ROLE_ZH, profileLine, itemLine };
