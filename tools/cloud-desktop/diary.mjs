// 日记的调度：什么时候写、写哪一天、失败就静默。
// 三类内容共用一套存储：每天一篇（daily）、每周一段回顾（weekly）、节日一封信（letter）。
import { readFile, writeFile } from 'node:fs/promises';

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
import { join } from 'node:path';
import { collectDay } from '../lol-companion/diary-source.mjs';
import { decide, dayKey, shiftDay, dayRange } from '../lol-companion/diary-day.mjs';
import { writeDiary, openingOf } from '../lol-companion/diary-write.mjs';
import { absenceLevel, festivalOn, timeBand, anniversaryOf, toneGuidance } from '../lol-companion/diary-mood.mjs';
import { promiseThreads, lineThread, mergeThreads, dueThreads, insightFor } from '../lol-companion/diary-threads.mjs';
import { weekKey, isStale, rankCandidates, summarize, trendPrompt, acceptTerm } from '../lol-companion/diary-trends.mjs';

async function readRows(stateDir) {
  let text;
  try { text = await readFile(join(stateDir, 'game-memory', 'match-history.jsonl'), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* 半截行跳过 */ }
  }
  return rows.filter(row => Number.isFinite(Number(row?.at)));
}

export function createDiary({ store, stateDir, query, ask, trendSource = null, role = () => '金宝', isIdle = () => true, now = Date.now, trace = () => {}, backfillDays = 3, retryMs = 60 * 1000, maxWritesPerTick = 2 }) {
  let running = false, lastAttempt = 0;
  const decided = new Set(); // 同一天的决定是确定的，别每次 tick 都重复记日志

  async function recentOpenings(limit = 3) {
    const recent = [];
    for (const row of await store.list({ limit })) {
      const entry = await store.get(row.day);
      if (entry) recent.push((entry.title ? entry.title + '｜' : '') + openingOf(entry));
    }
    return recent;
  }

  // 缺席多久、最近是不是来得少了：都从本机对局历史算，不猜。
  function absenceFor(today, rows) {
    const todayStart = dayRange(today).from;
    const past = rows.filter(row => Number(row.at) < todayStart);
    const daysSinceLastPlay = past.length
      ? Math.max(0, Math.round((todayStart - dayRange(dayKey(Math.max(...past.map(row => Number(row.at))))).from) / 86400e3))
      : 30;
    const within = (from, to) => rows.filter(row => Number(row.at) >= from && Number(row.at) < to).length;
    return absenceLevel({
      daysSinceLastPlay,
      recentGames: within(todayStart - 7 * 86400e3, todayStart),
      priorGames: within(todayStart - 14 * 86400e3, todayStart - 7 * 86400e3),
    });
  }

  // 一周查一次「网上在传什么」：热榜原文 → 让模型挑出真正的梗（一周一次调用）→ 存一周。
  // 宁可这周没有，也不把新闻/时政写进日记；挑不出来就记一条空的，这周不再重试。
  async function refreshTrends() {
    const saved = await store.trends().catch(() => null);
    if (!isStale(saved, now())) return summarize(saved);
    // 手工覆盖优先：想指定本周的说法时，改这个文件即可（{week,items}）。
    const manual = await readJson(join(stateDir, 'diary', 'trends-manual.json')).catch(() => null);
    if (manual?.week === weekKey(now()) && Array.isArray(manual.items)) {
      const record = { week: manual.week, at: now(), items: rankCandidates(manual.items), source: 'manual' };
      await store.saveTrends(record).catch(() => {});
      return summarize(record);
    }
    let texts = [];
    if (typeof trendSource === 'function') { try { texts = await trendSource(); } catch { texts = []; } }
    const prompt = trendPrompt(texts);
    let items = [];
    if (prompt) {
      try {
        const reply = await ask(prompt);
        const match = /\[[^\]]*\]/.exec(String(reply ?? ''));
        const parsed = match ? JSON.parse(match[0]) : [];
        items = (Array.isArray(parsed) ? parsed : []).map(acceptTerm).filter(Boolean).slice(0, 3);
      } catch (error) {
        // 教练正忙就下个 tick 再试，别把这一周记成「没有梗」。
        if (error?.status === 409) return summarize(saved);
        items = [];
      }
    }
    const record = { week: weekKey(now()), at: now(), items };
    await store.saveTrends(record).catch(() => {});
    trace({ event: 'diary_trends', week: record.week, count: items.length });
    return summarize(record);
  }  async function remember(entry, facts) {
    const threads = mergeThreads(
      (await store.threads()).map(thread => thread),
      [...lineThread(entry), ...promiseThreads(facts?.selfChats ?? [], entry.day)].map(thread => ({ ...thread, at: now() })),
    );
    await store.saveThreads(threads);
  }

  async function writeDaily(day, { rows, band, festival, anniversary, recent, trends = [] }) {
    // 缺席按「那一天」算：隔了十天回来，回来那天的日记才该是委屈的。
    const absence = absenceFor(day, rows);
    const facts = await collectDay({ stateDir, day, query });
    const decision = decide({ facts, day });
    if (!decision.write) {
      const key = 'skip:' + day;
      if (!decided.has(key)) { decided.add(key); trace({ event: 'diary_skipped', day, score: decision.score, probability: decision.probability, roll: Number(decision.roll.toFixed(3)) }); }
      return null;
    }
    const tone = toneGuidance({ absence, festival, band, anniversary });
    const entry = await writeDiary({ day, facts, decision, role: role(), recent, ask, now, tone, trends });
    const saved = await store.save(entry);
    await remember(saved, facts);
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
        const rows = await readRows(stateDir);
        const today = dayKey(now());
        const index = await store.list({ limit: 400 });
        const existing = new Set(index.map(row => row.day));
        const absence = absenceFor(today, rows);
        const band = timeBand(now());
        const first = index.map(row => row.day).sort()[0] ?? null;
        const anniversary = anniversaryOf({ today, first });
        const festival = festivalOn(today);
        const recent = () => recentOpenings();
        const trends = (await refreshTrends()).items;

        // 1) 节日信：上午九点之后才发，一天一封，比日记正式。
        if (festival && !existing.has(today) && new Date(now()).getHours() >= 9 && written.length < maxWritesPerTick) {
          const tone = toneGuidance({ absence, festival, band, anniversary, holidayGreeting: true });
          const entry = await writeDiary({
            day: today,
            facts: { day: today, matches: [], selfChats: [], herLines: [] },
            decision: { min: 150, max: 320, topic: 'festival', score: 0, topicLabel: festival.label },
            role: role(), recent: await recent(), ask, now, tone, letter: true, trends,
          });
          const saved = await store.save(entry);
          // 节日信的邮箱投递要服务端来做：客户端只持有被打码的邮箱（7***@qq.com），
          // 所以这里只落一份投递意图，服务端按账号取真实地址后就能发，不用改客户端。
          try {
            await writeFile(join(stateDir, 'diary', 'mail-intent-' + today + '.json'), JSON.stringify({
              day: today, festival: festival.key, festivalLabel: festival.label,
              subject: '金宝的' + festival.label + '信', body: saved.body, title: saved.title,
              role: saved.role, createdAt: now(), delivery: 'pending', requires: 'server-mail',
            }), { mode: 0o600 });
          } catch {}
          trace({ event: 'diary_letter', day: today, festival: festival.key, chars: saved.chars });
          written.push(saved);
        }

        // 2) 周回顾：只在周日写，且这一周真的玩过。
        const weekEntries = index.filter(row => row.kind === 'weekly' && row.day >= shiftDay(today, -7));
        if (new Date(now()).getDay() === 0 && !weekEntries.length && written.length < maxWritesPerTick) {
          const from = dayRange(shiftDay(today, -7)).from, to = dayRange(today).from;
          const week = rows.filter(row => Number(row.at) >= from && Number(row.at) < to);
          const days = new Set(week.map(row => dayKey(Number(row.at)))).size;
          if (days >= 3) {
            const insight = insightFor(rows, { now: now() });
            const tone = toneGuidance({ absence, band, festival, anniversary });
            const entry = await writeDiary({
              day: today,
              facts: { day: today, matches: week.map(row => ({ champion: row.champion, result: row.result, seconds: row.seconds, kda: row.kda, adviceRevoked: row?.advice?.revoked ?? 0 })), selfChats: [], herLines: [] },
              decision: { min: 200, max: 380, topic: 'weekly', score: 0, topicLabel: '这一周' },
              role: role(), recent: await recent(), ask, now, tone, weekly: true, insight: insight ?? '', trends,
            });
            const saved = await store.save(entry);
            trace({ event: 'diary_weekly', day: today, chars: saved.chars, insight: !!insight });
            written.push(saved);
            await remember(saved, null);
          }
        }

        // 3) 每日补写：只补昨天及更早、有素材、还没写过的。
        for (let back = 1; back <= backfillDays && written.length < maxWritesPerTick; back++) {
          const day = shiftDay(today, -back);
          if (existing.has(day)) continue;
          const facts = await collectDay({ stateDir, day, query });
          if (!facts.matches.length && !facts.selfChats.length && !facts.appChats) continue; // 那天没玩，没有可写的
          const saved = await writeDaily(day, { rows, band, festival, anniversary, recent: recent(), trends });
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
    // 教练用：拿一条「未了线」，或者退回到日记里那句还没用过的 line；一周最多两次。
    async threadForPrompt() {
      try {
        const threads = await store.threads();
        const due = dueThreads(threads, { now: now() });
        if (due.length) {
          const pick = due[0];
          await store.saveThreads(threads.map(thread => (thread.id === pick.id ? { ...thread, usedAt: now() } : thread)));
          // 日记里那句话也要打上已用，否则回退路径会把它再给一次。
          if (pick.kind === 'line') await store.markLineUsed(pick.day).catch(() => {});
          return { day: pick.day, text: pick.text };
        }
        const pending = await store.pendingLine({ today: dayKey(now()) });
        if (!pending) return null;
        await store.markLineUsed(pending.day);
        return { day: pending.day, text: pending.text };
      } catch { return null; }
    },
    async lineForPrompt() { return this.threadForPrompt(); },
    // 播报开场用：今天她的情绪（久别/来得少了/节日）。没有情绪就不返回。
    async currentTone() {
      try {
        if (!(await store.settings()).enabled) return null;
        const rows = await readRows(stateDir);
        const today = dayKey(now());
        const absence = absenceFor(today, rows);
        const festival = festivalOn(today);
        if (absence.level === 'normal' && !festival) return null;
        const pieces = [absence.level === 'normal' ? '' : absence.label + (absence.hint ? '：' + absence.hint : ''), festival ? '今天是' + festival.label : ''].filter(Boolean);
        return { level: absence.level, label: absence.label, days: absence.days, festival: festival?.label ?? null, hintText: pieces.join('；') };
      } catch (error) { return { error: String(error?.message ?? error) }; }
    },
  };
}
