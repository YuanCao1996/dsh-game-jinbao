// 日记的调度：什么时候写、写哪一天、失败就静默。
// 只在应用空闲、且那一天已经过去时才写（当天的不写，避免写成半截）。
import { collectDay } from '../lol-companion/diary-source.mjs';
import { decide, dayKey, shiftDay } from '../lol-companion/diary-day.mjs';
import { writeDiary, openingOf } from '../lol-companion/diary-write.mjs';

export function createDiary({ store, stateDir, query, ask, role = () => '金宝', isIdle = () => true, now = Date.now, trace = () => {}, backfillDays = 3, retryMs = 60 * 1000, maxWritesPerTick = 2 }) {
  let running = false, lastAttempt = 0;
  const decided = new Set(); // 同一天的决定是确定的，别每次 tick 都重复记一遍日志

  async function writeOne(day) {
    const facts = await collectDay({ stateDir, day, query });
    const decision = decide({ facts, day });
    if (!decision.write) {
      const key = 'skip:' + day;
      if (!decided.has(key)) { decided.add(key); trace({ event: 'diary_skipped', day, score: decision.score, probability: decision.probability, roll: Number(decision.roll.toFixed(3)) }); }
      return null;
    }
    const recent = [];
    for (const row of await store.list({ limit: 3 })) {
      const entry = await store.get(row.day);
      if (entry) recent.push((entry.title ? entry.title + '｜' : '') + openingOf(entry));
    }
    const entry = await writeDiary({ day, facts, decision, role: role(), recent, ask, now });
    const saved = await store.save(entry);
    trace({ event: 'diary_written', day, chars: saved.chars, topic: saved.topic, score: decision.score });
    return saved;
  }

  return {
    // 由 main 每隔几分钟调一次：完全幂等，写过的不会重复写。
    // force 只给「设置页点一下现在就写」用，跳过重试间隔，其它约束不变。
    async tick({ force = false } = {}) {
      if (running) return null;
      if (!force && now() - lastAttempt < retryMs) return null;
      if (!(await store.settings()).enabled) return null;
      if (!isIdle()) return null;
      running = true; lastAttempt = now();
      const written = [];
      try {
        const today = dayKey(now());
        const existing = new Set((await store.list({ limit: 400 })).map(row => row.day));
        for (let back = 1; back <= backfillDays && written.length < maxWritesPerTick; back++) {
          const day = shiftDay(today, -back);
          if (existing.has(day)) continue;
          const facts = await collectDay({ stateDir, day, query });
          if (!facts.matches.length && !facts.selfChats.length && !facts.appChats) continue; // 那天没玩，没有可写的
          const saved = await writeOne(day);
          if (saved) written.push(saved);
        }
      } catch (error) {
        trace({ event: 'diary_failed', code: String(error?.code ?? error?.status ?? 'error').slice(0, 32), message: String(error?.message ?? error).slice(0, 120) });
      } finally { running = false; }
      return written;
    },
    list: options => store.list(options),
    get: day => store.get(day),
    remove: day => store.remove(day),
    removeAll: () => store.removeAll(),
    settings: () => store.settings(),
    setSettings: patch => store.setSettings(patch),
    count: () => store.count(),
    // 教练用：把「她昨天惦记的那句话」取出来，并记为用掉（一周最多两次）。
    async lineForPrompt() {
      try {
        const pending = await store.pendingLine({ today: dayKey(now()) });
        if (!pending) return null;
        await store.markLineUsed(pending.day);
        return pending;
      } catch { return null; }
    },
  };
}
