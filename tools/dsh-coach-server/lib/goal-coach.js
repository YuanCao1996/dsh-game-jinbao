// Goal-mode coach: one long-lived DSH goal per match instead of per-event wake-ups.
//
// This is a separate product mode, not a tweak to the event-driven path. It owns its own
// session, its own goal revision and its own round budget; the two modes are mutually
// exclusive so a match can never be broadcast twice.

/** Default standing objective. Behavioural rules live here, not in the client loop. */
export const DEFAULT_GOAL_OBJECTIVE = [
  '陪玩家打好这一局。',
  '每一轮先用工具读取当前事实（对局状态、关键事件、双方装备与强化），再决定这一轮说什么。',
  '只在确有新信息且可执行时播报；没有新变化、没有把握或时机已过就保持静默，不刷屏。',
  '关键时机（团灭、破雾/破塔、大小龙、阵亡复活窗口、强化选择后）不得缺席。',
  '数值类结论（价格、冷却、强化效果、胜率）必须有工具结果支撑；查不到就说明缺口，不编造。',
  '每轮最多调用一次工具；上一轮已经确认过的事实不要重复读取。',
  '先查本地知识，本地没有结论再联网；只有当前动作取决于画面时才看截图。',
  '没有任何新变化时直接结束本轮，不调用工具、不输出内容。',
  '对局结束即停止建议，只给一条复盘。',
].join('\n');

/** Which loop should drive this install. Goal mode wins when explicitly enabled. */
export function resolveCoachMode(config) {
  return config?.goalCoach?.enabled === true ? 'goal' : 'event';
}

/**
 * Create the goal-mode provider. Every dependency is injected so the isolation rules can
 * be tested without running DSH.
 *
 * @param {object} deps
 * @param {() => object | undefined} deps.getGoals  resolves the DSH `goals` service
 * @param {(spec: object) => Promise<{agent: object}>} deps.createSession opens the match session
 * @param {() => number} [deps.now]
 * @param {(message: string, detail?: object) => void} [deps.log]
 */
export function createGoalCoach({ getGoals, createSession, now = Date.now, log = () => {}, roundGapMs = 0 } = {}) {
  let session = null;
  let goal = null;
  let startedAt = 0;
  let matches = '';
  let roundsSeen = 0;
  let lastRoundAt = 0;
  let pausedByUs = false;

  const goalsService = () => {
    try {
      return getGoals?.() ?? null;
    } catch {
      return null;
    }
  };

  return {
    /** Whether the harness exposes the goal service at all. */
    get supported() {
      return goalsService() !== null;
    },

    get active() {
      return goal !== null;
    },

    /**
     * Arm the match goal. Idempotent: a second call for the same match keeps the existing
     * goal instead of starting a parallel one.
     */
    async begin({ game, match, objective = DEFAULT_GOAL_OBJECTIVE, maxGoalRounds = 40 } = {}) {
      if (!match) throw new Error('goal coach requires a match id');
      if (goal !== null && match === matches) return { status: 'already-active', goalId: goal.id, match };
      if (goal !== null) await this.finish('match-replaced');

      const goals = goalsService();
      if (!goals) {
        log('goal mode unavailable: goals service missing', { match });
        return { status: 'unsupported', reason: 'goals_unavailable', match };
      }
      if (typeof createSession !== 'function') {
        log('goal mode unavailable: no session factory', { match });
        return { status: 'unsupported', reason: 'session_unavailable', match };
      }

      const opened = await createSession({ game, match });
      session = opened?.agent ?? null;
      if (!session) {
        log('goal mode unavailable: session not created', { match });
        return { status: 'unsupported', reason: 'session_not_created', match };
      }

      goal = goals.create(session, { objective, maxGoalRounds });
      startedAt = now();
      matches = match;
      log('goal mode armed', { match, goalId: goal.id, maxGoalRounds });
      return { status: 'active', goalId: goal.id, revision: goal.revision, maxGoalRounds, match };
    },

    /** Close the goal so the round driver stops. Safe to call when nothing is armed. */
    async finish(reason = 'match-ended') {
      const armed = goal;
      if (!armed) return { status: 'idle' };
      goal = null;
      const goals = goalsService();
      try {
        goals?.complete?.(session, { id: armed.id, revision: armed.revision });
      } catch (error) {
        log('goal completion failed', { goalId: armed.id, error: String(error?.message ?? error) });
      }
      const report = { status: 'completed', goalId: armed.id, reason, elapsedMs: startedAt ? now() - startedAt : 0 };
      startedAt = 0;
      matches = '';
      session = null;
      roundsSeen = 0;
      lastRoundAt = 0;
      pausedByUs = false;
      return report;
    },

    /**
     * Cost gate. The round driver continues as soon as the agent goes idle, so the only
     * way to slow spending is to pause the goal between rounds and resume when the gap
     * has elapsed. With roundGapMs = 0 this is a no-op.
     */
    gate() {
      if (!goal) return { status: 'idle' };
      const goals = goalsService();
      let view = null;
      try { view = goals?.get?.(session) ?? null; } catch { return { status: 'unreadable' }; }
      const current = view?.goal ?? view;
      if (!current) return { status: 'idle' };
      const rounds = Number(view?.roundsStarted ?? current.roundsStarted ?? 0);
      if (rounds !== roundsSeen) { roundsSeen = rounds; lastRoundAt = now(); }
      if (!roundGapMs) return { status: 'ungated', rounds };
      const ref = { id: current.id, revision: current.revision };
      const elapsed = lastRoundAt ? now() - lastRoundAt : roundGapMs;
      if (current.phase === 'active' && elapsed < roundGapMs) {
        try { goals.pause(session, ref); pausedByUs = true; return { status: 'paused', rounds }; } catch { return { status: 'pause-failed', rounds }; }
      }
      if (current.phase === 'paused' && pausedByUs && elapsed >= roundGapMs) {
        try { goals.resume(session, ref); pausedByUs = false; return { status: 'resumed', rounds }; } catch { return { status: 'resume-failed', rounds }; }
      }
      return { status: 'ok', rounds };
    },

    status() {
      return {
        mode: goal === null ? 'goal-idle' : 'goal-active',
        supported: goalsService() !== null,
        goalId: goal?.id ?? null,
        revision: goal?.revision ?? null,
        maxGoalRounds: goal?.maxGoalRounds ?? null,
        roundGapMs,
        roundsSeen,
        elapsedMs: startedAt ? now() - startedAt : 0,
      };
    },
  };
}
