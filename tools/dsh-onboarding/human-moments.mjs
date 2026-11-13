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
    opening: ['开局了，先把线站住。', '来了，这局慢慢打。', '开局，先别急。'],
    death: ['又是我先倒……', '这波换得不亏。', '没事，等我回来。'],
    endWin: ['这把赢了，稳。', '赢了，收工。', '拿下，打得不错。'],
    endNeutral: ['这把结束了。', '打完了，辛苦。'],
    endLoss: ['这把输了，但刚才那波是真的漂亮。', '输了，下一把赢回来。', '没拿下，我们复盘一下。'],
    idle: ['我一直在看，有事喊我。', '我盯着呢，别慌。'],
  },
  liurufeng: {
    opening: ['开局。按计划走。', '开始，先看线权。', '这一局，稳着来。'],
    death: ['这次交换不划算。', '记住这次的位置。', '节奏还在，别急。'],
    endWin: ['赢了，执行到位。', '拿下，继续这样打。'],
    endNeutral: ['这一局结束了。', '打完了，我们复盘一下。'],
    endLoss: ['输了。问题在中期那两波。', '没赢下来，我们找原因。'],
    idle: ['我在观察局势，需要就问我。'],
  },
  wangbatian: {
    opening: ['上！这局我说了算。', '开局就压，别怂。', '来了！跟我冲。'],
    death: ['倒一个不算什么！', '起来再打回去！', '别停，继续压。'],
    endWin: ['赢了！这就对了！', '漂亮，压倒对面！'],
    endNeutral: ['这局打完了！', '结束了，下一把继续。'],
    endLoss: ['输了？下次我带你打回来。', '这局不算，再来！'],
    idle: ['我在这儿盯着，谁不服就问我。'],
  },
  tiezhi: {
    opening: ['开局，先别送。', '开始了，稳住。', '来了来了，慢慢玩。'],
    death: ['又倒了，习惯了。', '这波有点亏。', '行吧，复活继续。'],
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

const pickOf = (list, pick) => {
  const index = Number.isInteger(pick) ? ((pick % list.length) + list.length) % list.length : 0;
  return list[index] ?? '';
};

function fresh(state, key) {
  const memory = state.humanMoments ?? (state.humanMoments = { match: state.match ?? '', emitted: {} });
  if (memory.match !== (state.match ?? '')) {
    state.humanMoments = { match: state.match ?? '', emitted: {}, deaths: 0, lastDeathAt: 0, lastAt: 0 };
    return state.humanMoments;
  }
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
export function settleHumanMoments(state, now = Date.now(), { role = 'jinbao', clock = null, ended = false, win = null } = {}) {
  if (!state || !state.match) return false;
  const memory = fresh(state);
  const voice = VOICES[role] ?? VOICES.jinbao;
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
    return emit('ended', pickOf(endVoice ?? voice.endLoss, memory.emitted.endedPick ?? 0));
  }

  // 战术建议刚说过话 → 这一轮不插嘴
  if (tacticalRecent(state, now)) return false;

  // 2) 开局问候：进对局 3 秒后，一局一次
  if (!memory.emitted.opening && Number.isFinite(seconds) && seconds >= OPENING_MIN_CLOCK && !ended) {
    return emit('opening', pickOf(voice.opening, 0));
  }

  // 3) 阵亡反应：最多 3 次、间隔 ≥45 秒
  if (!ended && state.me?.dead === true) {
    const firstTimeDead = memory.lastDeadSeen !== true;
    memory.lastDeadSeen = true;
    if (firstTimeDead && memory.deaths < DEATH_MAX_PER_MATCH && now - Number(memory.lastDeathAt || 0) >= DEATH_MIN_GAP_MS && now - lastAt >= MIN_GAP_MS) {
      memory.deaths = Number(memory.deaths || 0) + 1;
      memory.lastDeathAt = now;
      return emit('death', pickOf(voice.death, memory.deaths - 1));
    }
  } else if (state.me?.dead !== true) {
    memory.lastDeadSeen = false;
  }

  // 4) 长时间沉默：8 分钟没说过话且这局说过话 → 我还在（一局一次）
  if (!memory.emitted.idle && lastAt > 0 && now - lastAt >= IDLE_AFTER_MS && !ended) {
    return emit('idle', pickOf(voice.idle, 0));
  }
  return false;
}

export function resetHumanMoments(state) {
  if (!state) return;
  state.humanMoments = { match: state.match ?? '', emitted: {}, deaths: 0, lastDeathAt: 0, lastAt: 0 };
}
