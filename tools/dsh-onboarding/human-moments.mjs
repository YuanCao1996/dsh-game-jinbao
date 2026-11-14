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
    // 可爱队友感：短、软、不指挥；带事实槽位，取不到就换一句而不是硬编。
    opening: ['来啦～这局我陪你', '开局咯，先摸线权', '{champion}这局稳着来', '别急，慢慢打', '我在这儿，开吧', '开局咯，先发育'],
    firstDeath: ['第一次而已，我还在', '{level}级被抓，亏一点', '被抓啦？不怪你', '别慌，复活就回来', '这波他们人多，算了'],
    death: ['哎哟…这波怪我提醒晚了', '又是{opponent}？记住他', '他们技能交完了，赚的', '倒一次不亏，别急', '这波换得值，真的', '{minute}分钟了，稳住', '死就死吧，回来继续', '我数着呢，他们也没赚'],
    endWin: ['赢啦～这波团开得好', '拿下！{kills}个人头呢', '稳的，收工', '漂亮，这把没什么可挑的', '赢啦，累不累', '赢了！下把继续'],
    endNeutral: ['打完啦，歇会儿', '这局结束，等下一把', '打完了，手酸不酸', '结束咯，我还在'],
    endLoss: ['输了…中期那波太急了', '没拿下，别自责', '这局亏在{minute}分钟那波', '输就输了，下把赢回来', '可惜，其实打得不错', '没事，我陪你再来'],
    idle: ['我盯着呢，你先发育', '还在看，有事喊我', '我在，别慌', '安静发育，我守着你', '没动静？慢慢来'],
  },
  liurufeng: {
    opening: ['开局。按计划走。', '开始，先看线权。', '这一局，稳着来。'],
    firstDeath: ['第一次阵亡，代价可控。', '开局让一次，不影响节奏。'],
    death: ['这次交换不划算。', '记住这次的位置。', '节奏还在，别急。', '他们抓住了这个点位，换条线。', '下次先看视野再进。'],
    endWin: ['赢了，执行到位。', '拿下，继续这样打。'],
    endNeutral: ['这一局结束了。', '打完了，我们复盘一下。'],
    endLoss: ['输了。问题在中期那两波。', '没赢下来，我们找原因。'],
    idle: ['我在观察局势，需要就问我。'],
  },
  wangbatian: {
    opening: ['上！这局我说了算。', '开局就压，别怂。', '来了！跟我冲。'],
    firstDeath: ['先被我送了？无所谓，接着打！', '一血给他们，马上拿回来！'],
    death: ['倒一个不算什么！', '起来再打回去！', '别停，继续压。', '死一次换个机会，值！', '再来，我不信他们一直准。'],
    endWin: ['赢了！这就对了！', '漂亮，压倒对面！'],
    endNeutral: ['这局打完了！', '结束了，下一把继续。'],
    endLoss: ['输了？下次我带你打回来。', '这局不算，再来！'],
    idle: ['我在这儿盯着，谁不服就问我。'],
  },
  tiezhi: {
    opening: ['开局，先别送。', '开始了，稳住。', '来了来了，慢慢玩。'],
    firstDeath: ['第一个死了，正常。', '开局送一个，别急。'],
    death: ['又倒了，习惯了。', '这波有点亏。', '行吧，复活继续。', '死就死了，回来再打。', '这波不该进，记住了。'],
    endWin: ['赢了，可以。', '拿下，还行。'],
    endNeutral: ['打完了，行了。', '这局结束，休息一下。'],
    endLoss: ['输了，别难受。', '这把算了，下一把。'],
    idle: ['我还在，别担心。'],
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
function chooseMoment(pool, memory, kind, facts) {
  if (!Array.isArray(pool) || !pool.length) return '';
  const used = (memory.used || (memory.used = {}))[kind] || (memory.used[kind] = []);
  const start = Number((memory.cursor || {})[kind] || 0);
  const take = skipUsed => {
    for (let step = 0; step < pool.length; step += 1) {
      const index = (start + step) % pool.length;
      const template = pool[index];
      if (skipUsed && used.includes(template)) continue;
      const text = renderMoment(template, facts);
      if (!text) continue;
      memory.cursor = Object.assign({}, memory.cursor, { [kind]: index + 1 });
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
    return emit('ended', chooseMoment(endVoice ?? voice.endLoss, memory, 'ended', slots));
  }

  // 战术建议刚说过话 → 这一轮不插嘴
  if (tacticalRecent(state, now)) return false;

  // 2) 开局问候：进对局 3 秒后，一局一次
  if (!memory.emitted.opening && Number.isFinite(seconds) && seconds >= OPENING_MIN_CLOCK && !ended) {
    return emit('opening', chooseMoment(voice.opening, memory, 'opening', slots));
  }

  // 3) 阵亡反应：最多 3 次、间隔 ≥45 秒
  if (!ended && state.me?.dead === true) {
    const firstTimeDead = memory.lastDeadSeen !== true;
    memory.lastDeadSeen = true;
    if (firstTimeDead && memory.deaths < DEATH_MAX_PER_MATCH && now - Number(memory.lastDeathAt || 0) >= DEATH_MIN_GAP_MS && now - lastAt >= MIN_GAP_MS) {
      memory.deaths = Number(memory.deaths || 0) + 1;
      memory.lastDeathAt = now;
      // 首次阵亡用单独一套台词，避免每次送一血都说「又是我先倒」。
      const firstOfMatch = memory.deaths === 1;
      const pool = firstOfMatch && voice.firstDeath?.length ? voice.firstDeath : voice.death;
      return emit('death', chooseMoment(pool, memory, firstOfMatch ? 'firstDeath' : 'death', slots));
    }
  } else if (state.me?.dead !== true) {
    memory.lastDeadSeen = false;
  }

  // 4) 长时间沉默：8 分钟没说过话且这局说过话 → 我还在（一局一次）
  if (!memory.emitted.idle && lastAt > 0 && now - lastAt >= IDLE_AFTER_MS && !ended) {
    return emit('idle', chooseMoment(voice.idle, memory, 'idle', slots));
  }
  return false;
}

export function resetHumanMoments(state) {
  if (!state) return;
  state.humanMoments = { match: state.match ?? '', emitted: {}, used: {}, cursor: {}, deaths: 0, lastDeathAt: 0, lastAt: 0 };
}
