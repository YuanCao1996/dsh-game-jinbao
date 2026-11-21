// Differentiated, immediate praise for multi-kills.
//
// Deterministic on purpose: a model round-trip lands seconds later, after the moment
// has passed, and praise must never invent facts about the fight. Texts stay short so
// they survive the speech pipeline's 60-character single-segment rule.
//
// A multi-kill arrives as a chain of Multikill events (2 -> 3 -> 4 -> 5) a few seconds
// apart, so each chain settles briefly after its last kill and is praised once at its
// real level. The local player is praised from 2 kills; teammates only for quadra and
// penta, because doubling on every ally double kill would be noise.
//
// Tone follows the mentor the player actually selected (金宝/柳如风/王霸天/铁汁).

export const PRAISE_MAX_STREAK = 5;
export const ALLY_MIN_STREAK = 4;
export const PRAISE_CHAIN_MS = 10_000;
export const PRAISE_SETTLE_MS = 2_000;
export const PRAISE_MAX_WAIT_MS = 40_000;
export const PRAISE_ROLES = Object.freeze(['jinbao', 'liurufeng', 'wangbatian', 'tiezhi']);

// 台词模板：叹词 + 主语 + 多杀 + 反应 + 夸奖 +（被击杀者 + 幽默说法）。
// 例：哇塞，你这波三杀把我看愣住啦，牛呀！对面的安妮被你打成麻瓜了
const VOICE = {
  jinbao: {
    exclaim: ['哇塞', '耶', '嘿嘿'],
    react: ['把我看愣住啦', '看得我眼睛都直了', '我手都拍红啦'],
    praise: ['牛呀', '太厉害啦', '你太猛啦'],
    mock: ['被你打成麻瓜了', '话都说不出来', '直接不吭声了'],
  },
  liurufeng: {
    exclaim: ['不错', '很好'],
    react: ['节奏拿得很稳', '处理得很干净', '时机掐得正好'],
    praise: ['干得漂亮', '这就是执行力', '值得记一笔'],
    mock: ['被打崩了节奏', '完全接不住', '只能往回缩'],
  },
  wangbatian: {
    exclaim: ['漂亮', '痛快'],
    react: ['这才是该有的气势', '把对面按在地上打', '一点机会都没给'],
    praise: ['够狠', '就该这么打', '我服了'],
    mock: ['连还手的余地都没有', '直接被打穿了', '看着都没脾气了'],
  },
  tiezhi: {
    exclaim: ['行啊', '我服了'],
    react: ['这波我服', '看得我直乐', '真给我整不会了'],
    praise: ['可以啊', '有东西', '牛'],
    mock: ['被打得没脾气', '话都说不利索了', '直接摆烂了'],
  },
};

const STREAK_LABEL = { 2: '双杀', 3: '三杀', 4: '四杀', 5: '五杀' };
const pickOf = (list, pick) => {
  const index = Number.isInteger(pick) ? ((pick % list.length) + list.length) % list.length : 0;
  return list[index];
};

// 被击杀者：1 个 →「对面的安妮」；2 个 →「对面的安妮和塞拉斯」；3+ →「对面安妮、塞拉斯那几个」
function victimsClause(victims) {
  // 客户端给的是「名字#标签」，播报里只留名字；太长的昵称截 8 个字。
  const names = (Array.isArray(victims) ? victims : []).map(name => String(name ?? '').split('#')[0].trim().slice(0, 8)).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return '对面的' + names[0];
  if (names.length === 2) return '对面的' + names[0] + '和' + names[1];
  return '对面' + names.slice(0, 2).join('、') + '那几个';
}

export function praiseText({ streak, side = 'self', role = 'jinbao', hero = '', pick = 0, victims = [], revenge = [] } = {}) {
  const level = Number(streak);
  const label = STREAK_LABEL[level];
  if (!label) return '';
  if (side === 'ally' && level < 4) return '';   // 队友双杀/三杀不夸，太吵
  if (side !== 'self' && side !== 'ally') return '';
  const voice = VOICE[role] ?? VOICE.jinbao;
  const exclaim = pickOf(voice.exclaim, pick);
  const react = pickOf(voice.react, pick);
  const praise = pickOf(voice.praise, pick);

  if (side === 'ally') {
    const name = String(hero ?? '').trim().slice(0, 12);
    if (!name) return `${exclaim}，${label}！${praise}。`;
    return `${exclaim}，${name}这波${label}${react}，${praise}。`;
  }

  const revengeNames = (Array.isArray(revenge) ? revenge : []).map(name => String(name ?? '').trim()).filter(Boolean);
  const base = `${exclaim}，你这波${label}${react}，${praise}！`;
  if (revengeNames.length) return `${base}${revengeNames[0].slice(0, 12)}那笔仇报了。`;
  const victimsText = victimsClause(victims);
  if (!victimsText) return base;
  const mock = pickOf(voice.mock, pick);
  const composed = `${base}${victimsText}${mock}。`;
  // 语音单段上限 60 字：超了就把"被击杀者+幽默说法"整段去掉，不切断句子。
  return composed.length <= 60 ? composed : base;
}
// Names we accept for one participant. The live client reports riotId ("名字#tag") or
// summonerName, China-server summonerName is usually empty, and event KillerName comes
// WITHOUT the tag, so every non-empty form is kept with and without the tag.
function identities(person) {
  const out = new Set();
  for (const value of [person?.name, person?.riotId, person?.summonerName]) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out.add(trimmed);
    const bare = trimmed.replace(/#.*$/, '').trim();
    if (bare) out.add(bare);
  }
  return out;
}

function matched(person, killer) {
  const mine = identities(person);
  if (!mine.size) return false;
  if (mine.has(killer)) return true;
  const bare = killer.replace(/#.*$/, '').trim();
  return !!bare && mine.has(bare);
}

// side: 'self' | 'ally' | 'other'  (unknown/absent killer stays 'other')
export function whoKilled(state, event) {
  const killer = String(event?.killer ?? event?.KillerName ?? '').trim();
  if (!killer) return { side: 'other' };
  if (matched(state?.me, killer)) return { side: 'self' };
  for (const ally of state?.allies ?? []) {
    if (matched(ally, killer)) return { side: 'ally', hero: String(ally?.champion ?? '') };
  }
  return { side: 'other' };
}

const chainKey = (side, hero) => (side === 'ally' ? `ally:${String(hero ?? '')}` : 'self');

export function recordMultikill(state, { streak, side = 'self', hero = '', at, now, victims = [], revenge = [] } = {}) {
  const level = Number(streak);
  const minimum = side === 'ally' ? ALLY_MIN_STREAK : 2;
  if (!Number.isInteger(level) || level < minimum || level > PRAISE_MAX_STREAK) return false;
  if (side !== 'self' && side !== 'ally') return false;
  const stamp = Number.isFinite(at) ? at : now;
  if (!Number.isFinite(stamp)) return false;
  const chains = state.praiseChains ?? (state.praiseChains = {});
  const key = chainKey(side, hero);
  const prior = chains[key];
  const sameChain = !!prior && Math.abs(stamp - prior.lastAt) <= PRAISE_CHAIN_MS;
  if (sameChain && level < prior.streak) return false; // never downgrade a chain
  chains[key] = {
    key, side, hero, chainAt: sameChain ? prior.chainAt : stamp, lastAt: stamp,
    streak: level,
    // One praise per chain: an escalating 2 -> 3 -> 4 must not become three utterances.
    // The settle delay already waits for the chain's real final level.
    settled: sameChain ? prior.settled === true : false,
    variant: (prior?.variant ?? -1) + 1,
    // 同一波连杀里逐个累积击杀对象；复仇名单只保留本波命中的。
    victims: [...new Set([...(sameChain ? prior.victims ?? [] : []), ...(Array.isArray(victims) ? victims : [])])].slice(0, 5),
    revenge: [...new Set([...(sameChain ? prior.revenge ?? [] : []), ...(Array.isArray(revenge) ? revenge : [])])].slice(0, 3),
  };
  return true;
}

// Emit every chain that has gone quiet. Safe to call on each poll tick.
export function settlePraise(state, now = Date.now(), {
  settleMs = PRAISE_SETTLE_MS, maxWaitMs = PRAISE_MAX_WAIT_MS, role = 'jinbao', cloudGraceMs = 0,
} = {}) {
  const chains = state?.praiseChains;
  if (!chains) return false;
  let emitted = false;
  for (const chain of Object.values(chains)) {
    if (!chain || chain.settled) continue;
    // 云端那句已经到了（applyOverlayEvent 已经把文案写进 broadcasts），
    // 这里只把链标记为已结束，绝不再补一条本地文案把它盖掉。
    if (chain.cloudFilled) { chain.settled = true; continue; }
    const quiet = now - chain.lastAt >= settleMs;
    const stalled = now - chain.chainAt >= maxWaitMs;
    if (!quiet && !stalled) continue;
    // 云端优先：链安静后先等 cloudGraceMs 让云端那句话赶上来；
    // 等不到（模型慢或失败）才用本地兜底，避免玩家先听固定文案再被覆盖成两句。
    if (cloudGraceMs > 0 && !stalled && now - chain.lastAt < settleMs + cloudGraceMs) continue;
    const text = praiseText({ streak: chain.streak, side: chain.side, role, hero: chain.hero, pick: chain.variant, victims: chain.victims ?? [], revenge: chain.revenge ?? [] });
    if (!text) continue;
    const id = `${chain.key}@${chain.chainAt}`;
    state.broadcasts = (state.broadcasts ?? []).filter(reply => reply.praiseChain !== id);
    state.broadcasts.push({
      // at 必须是「现在」：语音只朗读 30 秒内的条目，用击杀时刻会让宽限期后的夸奖被静默丢掉。
      at: now,
      text, priority: 2, praise: true, praiseChain: id, praiseSide: chain.side,
      praiseHero: chain.side === 'ally' ? chain.hero : '', streak: chain.streak,
      variant: chain.variant, expiresAt: now + 12_000,
    });
    state.broadcasts = state.broadcasts.slice(-12);
    chain.settled = true;
    emitted = true;
  }
  return emitted;
}

export function resetPraise(state) {
  if (state) state.praiseChains = {};
}

// 从最近的击杀事件里取“这波我杀了谁”，并标出此前杀过我的人（复仇）。
// events: [{name:'ChampionKill', killer, victim, at/time}]，killedMeBefore: 本局杀过我的敌人名。
export function killInfoFromEvents({ events = [], me = '', killedMeBefore = [], windowMs = 10_000, now = Date.now() } = {}) {
 const names = new Set([String(me ?? '').trim()].filter(Boolean));
 const victims = [];
 const revenge = [];
 for (const event of events) {
  const name = String(event?.name ?? event?.EventName ?? '');
  if (name !== 'ChampionKill') continue;
  const at = Number(event?.at ?? event?.time ?? 0);
  if (Number.isFinite(at) && now - at > windowMs) continue;
  const killer = String(event?.killer ?? event?.KillerName ?? '').trim();
  const victim = String(event?.victim ?? event?.VictimName ?? '').trim();
  if (!killer || !victim) continue;
  if (![...names].some(candidate => candidate && (killer.includes(candidate) || candidate.includes(killer)))) continue;
  if (!victims.includes(victim)) victims.push(victim);
  if (killedMeBefore.some(who => who && (victim.includes(who) || who.includes(victim)))) {
   if (!revenge.includes(victim)) revenge.push(victim);
  }
 }
 return { victims: victims.slice(0, 3), revenge: revenge.slice(0, 2) };
}

// 极短兜底：云端失败时才用，不算固定句式（只有连杀级别）。
export function shortPraise(streak) {
 const level = Number(streak);
 if (!Number.isInteger(level) || level < 2) return '';
 const words = { 2: '双杀！', 3: '三杀！', 4: '四杀！', 5: '五杀！' };
 return words[Math.min(level, 5)] ?? (level + '连杀！');
}

// 交给云端的一句话点评请求：要求不开思考、只输出一句、不超过 40 字。
export function buildPraisePrompt({ streak, victims = [], revenge = [], hero = '', role = 'jinbao' } = {}) {
 const level = Number(streak) || 0;
 const killed = (Array.isArray(victims) ? victims : []).filter(Boolean);
 const revenged = (Array.isArray(revenge) ? revenge : []).filter(Boolean);
 const lines = [];
 lines.push('刚刚拿到' + level + '连杀' + (hero ? '（' + hero + '）' : '') + '。');
 if (killed.length) lines.push('这一波击杀：' + killed.join('、') + '。');
 if (revenged.length) lines.push('其中' + revenged.join('、') + '此前击杀过我，这是复仇。');
 lines.push('用教练口吻点评一句，可以有复仇的爽感，但不要煽情。');
 lines.push('硬性要求：只输出一句话，不超过 40 个字，不要解释、不要列举、不要换行、不要表情符号。');
 // 实测调用工具会让一次点评变成两次模型往返（约 8.6 秒），超过播报宽限就只能听本地兜底。
 lines.push('本句所需的连杀级别、击杀对象、复仇对象、自己的英雄都已在上文给全，不要调用任何工具，直接输出这一句话。');
 return lines.join('');
}
