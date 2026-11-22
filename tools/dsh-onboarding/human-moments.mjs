// 每局固定几句「人味」：开局、阵亡、结束、长时间沉默。
//
// 昨晚三条对局的实测：23/22/29 分钟里各只有 4/5/4 条播报，全部是出装建议；
// 38 次阵亡、74 分钟、21 次团灭，一句情绪反馈都没有；最长沉默 16.6 分钟。
//
// 所以这一层只做三件事：
//  1. 每局必有：开局一句、结束一句（胜负不同）
//  2. 阵亡有反应（最多 3 次，间隔 ≥45 秒）
//  3. 超过 8 分钟没说话 → 一句"我在"（每局一次）
//
// 硬约束：
//  - 战术建议优先：最近 15 秒内有战术播报时不插话
//  - 全局节流 25 秒
//  - 本地生成，不走模型（及时性）
//  - 死亡时不说活人话（与血量修正同源）

const VOICES = {
  jinbao: {
    // 可爱队友感 + 有活力：短句、带感叹、往前推；不指挥、不油腻。
    opening: ['来啦！这局冲鸭', '开局走起，先抢线', '{champion}出发！', '嘿嘿，一起上分', '开局！先手交给我', '状态满格，开打'],
    death: ['哎呀！这波怪我', '又是{opponent}！再来', '嘿嘿，技能全交值了', '等我复活，干回来', '{minute}分钟，稳住节奏', '一分不亏，继续冲', '起来！这次我来报点', '哎呦，别丧气', '{level}级这波亏了'],
    endWin: ['赢啦！这波开得漂亮', '拿下！{kills}个人头燃爆', '稳！这把打得像MVP', '漂亮！全程压着打', '赢了！再来一把', '哇塞，赢麻了'],
    endNeutral: ['打完啦，还挺燃', '这局结束，手热了', '收工！下把继续', '打完了，状态在线'],
    endLoss: ['天呐，输了！我还想打', '可惜！差一点翻盘', '别丧，下把打回来', '{minute}分钟那波，亏了', '输了也别泄气', '这把算热身，再来'],
    idle: ['我盯着呢，随时喊我上', '安静发育，攒波大招', '别停，节奏在我们', '嘻嘻，喊我就来', '稳着打，力气留着'],
    streakEnded: ['{n} 杀被终结了，太可惜啦', '哎呀，{n} 杀没了，下次再来', '对面总算把你拦下来了，{n} 杀结束'],
    pentaStolen: ['五杀被 {ally} 抢走啦，就差一个', '{ally} 拿了五杀，你差一步呀', '哎呀，五杀给 {ally} 了'],
    allyAfk: ['{ally} 好像不动了，这波先当 4 打 5', '{ally} 半天没动，小心点', '感觉 {ally} 掉线了，稳一点'],
    firstChampion: ['第一次玩 {champion}，我陪你摸索', '{champion} 第一次上手，稳着来', '新英雄 {champion}，先熟悉手感'],
    winStreak: ['{n} 连胜啦，你最近手感真好', '连赢 {n} 场，我要记下来', '{n} 连胜，稳住这个状态'],
  },
  liurufeng: {
    opening: ['开局。按计划走。', '开始，先看线权。', '这一局，稳着来。'],
    death: ['这次交换不划算。', '记住这次的位置。', '节奏还在，别急。', '他们抓住了这个点位，换条线。', '下次先看视野再进。'],
    endWin: ['赢了，执行到位。', '拿下，继续这样打。'],
    endNeutral: ['这一局结束了。', '打完了，我们复盘一下。'],
    endLoss: ['输了。问题在中期那两波。', '没赢下来，我们找原因。'],
    idle: ['我在观察局势，需要就问我。'],
    streakEnded: ['{n} 杀被终结，位置被算到了', '这波断了，{n} 杀到此为止', '他们盯上你了，{n} 杀结束'],
    pentaStolen: ['五杀落在 {ally} 手上，节奏没问题', '{ally} 收了第五个，你差一个', '这波五杀归 {ally}'],
    allyAfk: ['{ally} 四分钟没动，按少一个人打', '{ally} 可能掉线了，收缩阵型', '队友 {ally} 静止，先别再开团'],
    firstChampion: ['{champion} 第一次用，先按标准节奏走', '首次拿 {champion}，别急着秀', '{champion} 首次登场，稳发育'],
    winStreak: ['已经 {n} 连胜，节奏稳定', '{n} 连胜，保持这套打法', '连胜 {n} 场，说明判断是对的'],
  },
  wangbatian: {
    opening: ['上！这局我说了算。', '开局就压，别怂。', '来了！跟我冲。'],
    death: ['倒一个不算什么！', '起来再打回去！', '别停，继续压。', '死一次换个机会，值！', '再来，我不信他们一直准。'],
    endWin: ['赢了！这就对了！', '漂亮，压倒对面！'],
    endNeutral: ['这局打完了！', '结束了，下一把继续。'],
    endLoss: ['输了？下次我带你打回来。', '这局不算，再来！'],
    idle: ['我在这儿盯着，谁不服就问我。'],
    streakEnded: ['{n} 杀被断了？再来一次', '被人终结了，{n} 杀不算完', '行，{n} 杀被他们断了，继续压'],
    pentaStolen: ['五杀让 {ally} 拿走了，下次自己收', '{ally} 抢了你的五杀，记着', '就差一个，五杀给了 {ally}'],
    allyAfk: ['{ally} 不动了？那就我们自己打', '{ally} 挂机，照打不误', '{ally} 掉线，少个人也压'],
    firstChampion: ['{champion} 第一次玩？照样压', '新英雄 {champion}，上去试试', '{champion} 没玩过？那就打给他们看'],
    winStreak: ['{n} 连胜！就这个气势', '连赢 {n} 把，谁敢拦', '{n} 连胜，继续压'],
  },
  tiezhi: {
    opening: ['开局，先别送。', '开始了，稳住。', '来了来了，慢慢玩。'],
    death: ['又倒了，习惯了。', '这波有点亏。', '行吧，复活继续。', '死就死了，回来再打。', '这波不该进，记住了。'],
    endWin: ['赢了，可以。', '拿下，还行。'],
    endNeutral: ['打完了，行了。', '这局结束，休息一下。'],
    endLoss: ['输了，别难受。', '这把算了，下一把。'],
    idle: ['我还在，别担心。'],
    streakEnded: ['{n} 杀断了，对面松了口气', '好家伙，{n} 杀就这么没了', '{n} 杀被终结，他们很开心吧'],
    pentaStolen: ['五杀被 {ally} 截胡了，血亏', '{ally} 拿五杀，你白打四个', '五杀没了，{ally} 得请你吃饭'],
    allyAfk: ['{ally} 挂着呢，四打五了', '{ally} 好像人不在', '好家伙，{ally} 直接挂机'],
    firstChampion: ['{champion} 头一回玩，别送太早', '第一次用 {champion}？有点意思', '{champion} 新手局，慢慢来'],
    winStreak: ['{n} 连胜，最近有点东西啊', '连赢 {n} 场，可以吹了', '{n} 连胜，别飘'],
  },
};

export const MOMENT_ROLES = Object.freeze(Object.keys(VOICES));
export const OPENING_MIN_CLOCK = 3;          // 进对局 3 秒后才问好，避免还在加载
export const DEATH_MIN_GAP_MS = 45_000;      // 两次阵亡反应至少隔 45 秒
export const DEATH_MAX_PER_MATCH = 3;        // 一局最多反应 3 次阵亡
export const IDLE_AFTER_MS = 8 * 60_000;     // 8 分钟没说话 → 我还在
export const MIN_GAP_MS = 25_000;            // 两句人味之间至少 25 秒
export const TACTICAL_GUARD_MS = 15_000;     // 最近 15 秒有战术播报 → 不插话

const MOMENT_SLOTS = /\{([a-zA-Z]+)\}/g;

// 事实槽位：取不到就留空，由选择器换一句，绝不编造。
export function momentFacts(state, extra = {}) {
  const me = (state && state.me) || {};
  const enemies = Array.isArray(state && state.enemies) ? state.enemies : [];
  const number = value => (Number.isFinite(Number(value)) ? Number(value) : null);
  const seconds = number(state && state.gameSeconds);
  return Object.assign({
    champion: String((state && state.selfChampion) || me.champion || ''),
    level: number(me.level),
    minute: seconds === null ? null : Math.floor(seconds / 60),
    kills: number(me.k),
    deaths: number(me.d),
    opponent: String((enemies[0] && enemies[0].champion) || ''),
  }, extra);
}

export function renderMoment(template, facts = {}) {
  let missing = false;
  const text = String(template || '').replace(MOMENT_SLOTS, (_, key) => {
    const value = facts[key];
    if (value === null || value === undefined || value === '') { missing = true; return ''; }
    return String(value);
  });
  return missing ? '' : text;
}

// 本局同一条不重复：用尽后重置，避免一局听到两句一样的。
// 跨对局轮换：以前每局都从 cursor=0 开始，所以永远听到第一句（"来啦！这局冲鸭"）。
// 现在用「角色+类型」做轮子，下一局接着上一局的下一条；进程重启后用对局号做偏移。
const MOMENT_WHEEL = new Map();
const hashText = text => {
  let h = 0;
  for (const ch of String(text ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

function chooseMoment(pool, memory, kind, facts, wheelKey = '') {
  if (!Array.isArray(pool) || !pool.length) return '';
  const used = (memory.used || (memory.used = {}))[kind] || (memory.used[kind] = []);
  const saved = Number((memory.cursor || {})[kind]);
  const hasWheel = !!wheelKey && MOMENT_WHEEL.has(wheelKey);
  const wheel = Number(MOMENT_WHEEL.get(wheelKey) ?? 0);
  const start = Number.isFinite(saved) ? saved : (hasWheel ? wheel : hashText(memory.match) % pool.length);
  const take = skipUsed => {
    for (let step = 0; step < pool.length; step += 1) {
      const index = (start + step) % pool.length;
      const template = pool[index];
      if (skipUsed && used.includes(template)) continue;
      const text = renderMoment(template, facts);
      if (!text) continue;
      memory.cursor = Object.assign({}, memory.cursor, { [kind]: index + 1 });
      if (wheelKey) MOMENT_WHEEL.set(wheelKey, (index + 1) % pool.length);
      return { text, template };
    }
    return null;
  };
  let picked = take(true);
  if (!picked) { memory.used[kind] = []; picked = take(false); }
  if (!picked) return '';
  memory.used[kind].push(picked.template);
  if (memory.used[kind].length >= pool.length) memory.used[kind] = [];
  return picked.text;
}

function fresh(state, key) {
  let memory = state.humanMoments;
  if (!memory || memory.match !== (state.match ?? '')) {
    memory = state.humanMoments = { match: state.match ?? '', emitted: {}, used: {}, cursor: {}, deaths: 0, lastDeathAt: 0, lastAt: 0 };
    return memory;
  }
  // 旧版本写下的记忆缺计数：补默认值，否则阵亡判定会因 undefined 永远不成立。
  if (!Number.isFinite(Number(memory.deaths))) memory.deaths = 0;
  if (!Number.isFinite(Number(memory.lastDeathAt))) memory.lastDeathAt = 0;
  if (!Number.isFinite(Number(memory.lastAt))) memory.lastAt = 0;
  return memory;
}

function tacticalRecent(state, now, windowMs = TACTICAL_GUARD_MS) {
  const list = Array.isArray(state.broadcasts) ? state.broadcasts : [];
  return list.some(b => b && !b.choiceReaction && !b.humanMoment && Number(b.at) <= now && now - Number(b.at) <= windowMs);
}

// 触发型台词：由 overlay 侧检测到事件后排队（state.pendingMoments），这里统一渲染+落播报。
// 与「人味句」共用同一套语音通道，但每条的 humanKey 独立，不会互相顶掉。
export const EXTRA_MOMENT_KINDS = Object.freeze(['streakEnded', 'pentaStolen', 'allyAfk', 'firstChampion', 'winStreak']);

export function settleExtraMoments(state, now = Date.now(), { role = 'jinbao' } = {}) {
  if (!state || !Array.isArray(state.pendingMoments) || !state.pendingMoments.length) return false;
  const voice = VOICES[role] ?? VOICES.jinbao;
  const queue = state.pendingMoments.splice(0);
  let emitted = false;
  for (const item of queue) {
    const kind = String(item?.kind ?? '');
    const pool = voice[kind];
    if (!EXTRA_MOMENT_KINDS.includes(kind) || !Array.isArray(pool) || !pool.length) continue;
    const key = 'extra:' + kind + ':' + String(item?.key ?? '');
    if ((state.broadcasts ?? []).some(b => b.humanKey === key)) continue;
    const facts = item?.facts ?? {};
    // 同 key 稳定取同一句，避免同一条链刷出两句不同的。
    let seed = 0;
    for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const text = renderMoment(pool[seed % pool.length], facts);
    if (!text) continue;
    state.broadcasts = (state.broadcasts ?? []).filter(b => b.humanKey !== key);
    state.broadcasts.push({
      at: now, text, priority: 2, praise: true, humanMoment: true,
      humanKey: key, humanKind: kind, expiresAt: now + 12_000,
    });
    state.broadcasts = state.broadcasts.slice(-12);
    emitted = true;
  }
  return emitted;
}

function push(state, text, now, extra = {}) {
  if (!text) return false;
  state.broadcasts = (state.broadcasts ?? []).filter(b => b.humanKey !== extra.humanKey);
  state.broadcasts.push({
    at: now, text, priority: 2, praise: true, humanMoment: true, expiresAt: now + 12_000, ...extra,
  });
  state.broadcasts = state.broadcasts.slice(-12);
  return true;
}

// 由扫描循环调用：state 是本局状态，clock 是游戏内秒数。
export function settleHumanMoments(state, now = Date.now(), { role = 'jinbao', clock = null, ended = false, win = null, facts = null } = {}) {
  if (!state || !state.match) return false;
  const memory = fresh(state);
  const voice = VOICES[role] ?? VOICES.jinbao;
  const slots = momentFacts(state, facts || {});
  const seconds = Number(clock);
  const lastAt = Number(memory.lastAt) || 0;

  const emit = (kind, text, extra = {}) => {
    if (!push(state, text, now, { humanKey: kind, humanKind: kind, ...extra })) return false;
    memory.emitted[kind] = true;
    memory.lastAt = now;
    return true;
  };

  // 1) 结束语优先：对局结束的那一刻，别被阵亡/沉默抢先
  if (ended && !memory.emitted.ended) {
    const endVoice = win === true ? voice.endWin : win === false ? voice.endLoss : (voice.endNeutral ?? voice.endLoss);
    return emit('ended', chooseMoment(endVoice ?? voice.endLoss, memory, 'ended', slots, role + ':ended'));
  }

  // 战术建议刚说过话 → 这一轮不插嘴
  if (tacticalRecent(state, now)) return false;

  // 2) 开局问候：进对局 3 秒后，一局一次
  if (!memory.emitted.opening && Number.isFinite(seconds) && seconds >= OPENING_MIN_CLOCK && !ended) {
    return emit('opening', chooseMoment(voice.opening, memory, 'opening', slots, role + ':opening'));
  }

  // 3) 阵亡反应：最多 3 次、间隔 ≥45 秒
  if (!ended && state.me?.dead === true) {
    const firstTimeDead = memory.lastDeadSeen !== true;
    memory.lastDeadSeen = true;
    if (firstTimeDead && memory.deaths < DEATH_MAX_PER_MATCH && now - Number(memory.lastDeathAt || 0) >= DEATH_MIN_GAP_MS && now - lastAt >= MIN_GAP_MS) {
      memory.deaths = Number(memory.deaths || 0) + 1;
      memory.lastDeathAt = now;
      // 第一次阵亡不播报：只说「第一次」既生硬又没信息量（用户明确要求去掉这类播报）。
      if (memory.deaths === 1) return null;
      return emit('death', chooseMoment(voice.death, memory, 'death', slots, role + ':death'));
    }
  } else if (state.me?.dead !== true) {
    memory.lastDeadSeen = false;
  }

  // 4) 长时间沉默：8 分钟没说过话且这局说过话 → 我还在（一局一次）
  if (!memory.emitted.idle && lastAt > 0 && now - lastAt >= IDLE_AFTER_MS && !ended) {
    return emit('idle', chooseMoment(voice.idle, memory, 'idle', slots, role + ':idle'));
  }
  return false;
}

export function resetHumanMoments(state) {
  if (!state) return;
  state.humanMoments = { match: state.match ?? '', emitted: {}, used: {}, cursor: {}, deaths: 0, lastDeathAt: 0, lastAt: 0 };
}
