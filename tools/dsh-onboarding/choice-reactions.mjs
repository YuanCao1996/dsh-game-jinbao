// 玩家做选择后的即时反馈：买了什么、选了哪个海克斯，跟刚才推荐的比一比，
// 然后按当前导师的人设回一句 —— 及时、有人味，不额外调模型。
//
// 为什么本地生成：模型往返通常 3–6 秒，而"你刚按下购买"的反馈窗口只有一两秒；
// 多杀点评已经有"云端优先、等不到就本地兜底"的先例，这里直接走本地。
//
// 文案原则：
//  - 一句，不超过 30 字，能直接进语音（60 字上限内）
//  - 听话 → 肯定；不听话 → 调侃，但不人身攻击
//  - 同一个人设、同一种结果，用 pick 轮换，避免每次都同一句
//  - 连续两次以上"不听话"时，调侃升级一档（犟种 → 你今天是铁了心）

const VOICES = {
  jinbao: {
    agree: {
      item: ['买对了，这件正是我刚才说的。', '照这个出就对了，继续。', '听我的准没错，就是它。'],
      augment: ['这个强化选得明智。', '正是我推荐的那张，稳。', '选它没错，接下来围绕它打。'],
    },
    disagree: {
      item: ['行吧，随你。', '你还真是个犟种。', '好，我记下了，看你怎么赢。'],
      augment: ['行，你有你的想法。', '哼，不听我的？', '好，我倒要看看这张能玩成什么样。'],
    },
    escalate: {
      item: ['第几次了，你今天铁了心不听。', '行，你是老板，我只是个跟班。'],
      augment: ['又是你自己挑的，我不说了。', '你这脾气，我算是记住了。'],
    },
  },
  liurufeng: {
    agree: {
      item: ['很好，按计划执行。', '这件装备选得干净。', '顺着这条路走，别偏。'],
      augment: ['判断正确。', '这张与你的路线一致。', '选它，收益最大。'],
    },
    disagree: {
      item: ['你的选择，我尊重，但我会记录下来。', '不按推荐走，风险你自己扛。', '可以，但代价会在后面。'],
      augment: ['我持保留意见。', '你有自己的理由，说来听听。', '这一手我不认同，但随你。'],
    },
    escalate: {
      item: ['连续偏离计划，这种打法很吃操作。', '你在走一条更窄的路。'],
      augment: ['又一次不同判断，我会按你的路线重算。', '你的选择我记下了，后面别怪没人提醒。'],
    },
  },
  wangbatian: {
    agree: {
      item: ['这就对了，跟我走不会错！', '痛快，就该这么出！', '听我的，压上去！'],
      augment: ['好眼力！这张就是最好的。', '选它，见谁打谁！', '够果断，我喜欢！'],
    },
    disagree: {
      item: ['你非要这么出？行啊。', '犟！我服了。', '不听是吧，那你可别输。'],
      augment: ['你选这个？我不同意，但随你。', '哼，看你怎么打。', '好，有种，输了别哭。'],
    },
    escalate: {
      item: ['你这是跟推荐杠上了！', '第几次了？我记住你了。'],
      augment: ['又跟我对着干，真行。', '你这是要把我气死啊。'],
    },
  },
  tiezhi: {
    agree: {
      item: ['行啊，这件出得对。', '听劝，挺难得。', '这个选择挺聪明。'],
      augment: ['选得不错，这张挺顺手。', '有眼光，就要这张。', '听我的，准没错。'],
    },
    disagree: {
      item: ['随你吧，反正你上场。', '你还真是个犟种。', '行，等着看效果。'],
      augment: ['行吧，你开心就好。', '这张？我持保留意见。', '不听劝，我又能怎么办呢。'],
    },
    escalate: {
      item: ['第三次了，你是真不听。', '行，我摊手了。'],
      augment: ['你这是专挑我不推荐的选啊。', '算了，你继续。'],
    },
  },
};

export const CHOICE_ROLES = Object.freeze(Object.keys(VOICES));
const RECOMMEND_HINT = /出装|成装|下一件|先买|优先做|合成|推荐选|首选|核心装/;

const pickOf = (list, pick) => {
  const index = Number.isInteger(pick) ? ((pick % list.length) + list.length) % list.length : 0;
  return list[index] ?? '';
};

export function choiceReaction({ role = 'jinbao', kind = 'item', agreed = false, repeat = 0, pick = 0, name = '' } = {}) {
  const voice = VOICES[role] ?? VOICES.jinbao;
  const table = agreed ? voice.agree : (repeat >= 2 ? voice.escalate : voice.disagree);
  const list = table?.[kind === 'augment' ? 'augment' : 'item'];
  if (!list?.length) return '';
  const text = pickOf(list, pick);
  // 只有肯定时才点名，避免"你还真是个犟种：心之钢"这种读起来像骂人。
  return agreed && name ? `${text}` : text;
}

// 他到底听没听：从最近一条建议里解析出「明确推荐的装备/海克斯」，再和实际选择比。
// 关键区别：以前只要建议里没出现买的东西就算「不听」，导致每次选海克斯都喷一句
// 「哼，不听我的？」。没有明确推荐时应当保持安静。
function recommendedName(broadcasts, kind) {
  const recent = (Array.isArray(broadcasts) ? broadcasts : [])
    .filter(b => b && !b.revoked && Number.isFinite(Number(b.at)))
    .sort((a, b) => Number(b.at) - Number(a.at))
    .slice(0, 5);
  for (const b of recent) {
    const text = String(b.text ?? '');
    if (kind === 'augment') {
      const named = /推荐选\s*([^\s，。；、（）()]{2,12})/.exec(text)
        ?? /(?:首选|优先选|建议选)\s*([^\s，。；、（）()]{2,12})/.exec(text);
      if (named) return named[1];
      continue;
    }
    const next = /(?:下一件|优先做|优先买|先买|先做|合成)\s*[：:]?\s*([^\s，。；、（）()]{2,12})/.exec(text);
    if (next) return next[1];
    const order = /^[^→]{0,12}?([^\s，。；、→]{2,12})\s*→/.exec(text);
    if (order) return order[1];
  }
  return '';
}

// 名字可能一个说成装、一个说部件（反曲之弓 vs 破败王者之刃），用包含关系放宽。
function sameChoice(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function recordChoice(state, { kind, name, at = Date.now() }) {
  if (!state || !name) return;
  const key = `${kind}:${name}`;
  const pending = state.pendingChoices ?? (state.pendingChoices = []);
  if (pending.some(item => item.key === key && Math.abs(at - item.at) < 20_000)) return;  // 重复读同一件事
  pending.push({ key, kind, name, at });
  if (pending.length > 4) pending.splice(0, pending.length - 4);
}

export function settleChoiceReactions(state, now = Date.now(), { role = 'jinbao', maxAgeMs = 8_000 } = {}) {
  const pending = state?.pendingChoices;
  if (!Array.isArray(pending) || !pending.length) return false;
  let emitted = false;
  const spread = state.choiceStreak ?? (state.choiceStreak = { agree: 0, disagree: 0 });
  for (const item of pending.splice(0)) {
    if (!item || now - Number(item.at) > maxAgeMs) continue;      // 过期的不再补话，避免马后炮
    const target = recommendedName(state.broadcasts, item.kind);
    if (!target) continue;                                          // 没有明确推荐 → 不评价
    const agreed = sameChoice(item.name, target);
    if (agreed) { spread.agree += 1; spread.disagree = 0; }
    else { spread.disagree += 1; spread.agree = 0; }
    const text = choiceReaction({ role, kind: item.kind, agreed, repeat: Math.max(0, spread.disagree - 1), pick: spread[agreed ? 'agree' : 'disagree'], name: item.name });
    if (!text) continue;
    state.broadcasts = (state.broadcasts ?? []).filter(b => b.choiceKey !== item.key);
    state.broadcasts.push({
      at: item.at, text, priority: 2, praise: true, choiceReaction: true, choiceKey: item.key,
      choiceKind: item.kind, agreed, expiresAt: now + 12_000,
    });
    state.broadcasts = state.broadcasts.slice(-12);
    emitted = true;
  }
  return emitted;
}

export function resetChoiceReactions(state) {
  if (!state) return;
  state.pendingChoices = [];
  state.choiceStreak = { agree: 0, disagree: 0 };
}
