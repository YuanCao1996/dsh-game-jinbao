import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiary } from '../diary.mjs';
import { createDiaryStore } from '../../dsh-onboarding/diary-store.mjs';
import { decide, dayStart, shiftDay, stableRoll } from '../../lol-companion/diary-day.mjs';

const line = value => JSON.stringify(value) + '\n';
// 一天的正文要有 280—450 字，否则在「长」档里会被判太短。
const BODY = '他今天一句话都没回我，我改口三次，先说出鞋子又说别急最后干脆不说了。'.repeat(8);
const GOOD = JSON.stringify({ title: '改口三次', body: BODY, mood: '心虚', line: '明天再讲吧' });
// 让 now 落在 targetDay 的第二天中午：这样 tick 补写的正好是 targetDay。
const nowFor = day => dayStart(day) + 86400e3 + 12 * 3600e3;

async function fixture({ days = [], now, settings, chats = true } = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'jinbao-diary-'));
  await mkdir(join(stateDir, 'game-memory'), { recursive: true });
  const rows = [];
  for (const day of days) {
    const base = dayStart(day) + 17 * 3600e3;
    for (let index = 0; index < 3; index++) {
      rows.push({ at: base + index * 1200e3, match: `lol-live-${day}-${index}.jsonl#1`, game: 'lol', champion: ['星籁歌姬', '安妮', '亚索'][index], result: ['win', 'lose', null][index], seconds: 900, kda: { k: 3, d: 5, a: 9 } });
    }
  }
  await writeFile(join(stateDir, 'game-memory/match-history.jsonl'), rows.map(line).join(''));
  const query = async () => (chats ? { rows: [{ event: { kind: 'chat_events', events: ['打野来下路', '别急我来了', '这波我C', '你等我', '换线了', '走了'].map(text => ({ kind: 'team_chat', text, self: true })) } }] } : { rows: [] });
  const asked = [], events = [];
  const store = createDiaryStore({ stateDir });
  if (settings) await store.setSettings(settings);
  const clock = { at: now };
  const diary = createDiary({
    store, stateDir, query,
    ask: async () => { asked.push(1); return GOOD; },
    role: () => '金宝',
    isIdle: () => clock.idle !== false,
    now: () => clock.at,
    retryMs: 0,
    trace: event => events.push(event),
  });
  return { stateDir, store, diary, asked, events, clock };
}

test('第二天补写昨天的日记；重复 tick 不会多写一篇', async () => {
  const day = '2026-11-15';
  const f = await fixture({ days: [day], now: nowFor(day) });
  try {
    const written = await f.diary.tick();
    assert.equal(written.length, 1, JSON.stringify(f.events));
    assert.equal(written[0].day, day);
    assert.equal(written[0].mood, '心虚');
    assert.equal(f.asked.length, 1, '只调用一次模型');
    assert.equal((await f.store.list()).length, 1);
    assert.ok(f.events.some(event => event.event === 'diary_written'));
    await f.diary.tick();
    assert.equal(f.asked.length, 1, '已经写过就不再调用模型');
    assert.equal((await f.store.list()).length, 1);
    const entry = await f.diary.get(day);
    assert.ok(entry.paragraphs.length >= 1);
    assert.ok(entry.chars >= 200);
  } finally { await rm(f.stateDir, { recursive: true, force: true }); }
});

test('对局中、开关关闭、什么都没发生：三种情况都不写', async () => {
  const day = '2026-11-15';
  const now = nowFor(day);

  const busy = await fixture({ days: [day], now });
  try { busy.clock.idle = false; await busy.diary.tick(); assert.equal(busy.asked.length, 0, '对局中不写'); } finally { await rm(busy.stateDir, { recursive: true, force: true }); }

  const off = await fixture({ days: [day], now, settings: { enabled: false } });
  try { await off.diary.tick(); assert.equal(off.asked.length, 0, '关掉就不写'); assert.equal((await off.store.list()).length, 0); } finally { await rm(off.stateDir, { recursive: true, force: true }); }

  const empty = await fixture({ days: [], now });
  try { await empty.diary.tick(); assert.equal(empty.asked.length, 0, '没玩就不写'); assert.equal((await empty.store.list()).length, 0); } finally { await rm(empty.stateDir, { recursive: true, force: true }); }
});

test('那天她决定不写时，就是没有这篇（而不是写一篇凑数）', async () => {
  let day = null;
  for (let offset = 1; offset <= 60 && !day; offset++) {
    const candidate = shiftDay('2026-12-20', -offset);
    const roll = stableRoll(`${candidate}:jinbao-diary`);
    if (roll >= 0.12) day = candidate; // 一局 = 1 分 = 12% 概率，掷不中就这天不写
  }
  assert.ok(day, '应当能找到一天：分数低且掷骰没中');
  const f = await fixture({ days: [], now: nowFor(day), chats: false });
  try {
    await writeFile(join(f.stateDir, 'game-memory/match-history.jsonl'), line({ at: dayStart(day) + 17 * 3600e3, match: 'one', game: 'lol', champion: '亚索', result: 'win' }));
    await f.diary.tick();
    assert.equal(f.asked.length, 0, '没掷中就不调用模型');
    assert.equal((await f.store.list()).length, 0);
    assert.ok(f.events.some(event => event.event === 'diary_skipped' && event.day === day));
  } finally { await rm(f.stateDir, { recursive: true, force: true }); }
});

test('一次最多补两篇，剩下的下次再补', async () => {
  // 找一个「今天」，让前三天都有很高的分数（3 局 + 6 句），确保三天都掷中。
  let today = null, days = [];
  for (let offset = 0; offset < 40 && !today; offset++) {
    const candidate = shiftDay('2026-12-20', -offset);
    const set = [1, 2, 3].map(back => shiftDay(candidate, -back));
    if (set.every(day => decide({ facts: { day, matches: [{}, {}, {}], selfChats: ['a', 'b', 'c', 'd', 'e', 'f'] }, day }).write)) { today = candidate; days = set; }
  }
  assert.ok(today, '应当能找到连续三天都掷中的窗口');
  const f = await fixture({ days, now: dayStart(today) + 12 * 3600e3 });
  try {
    await f.diary.tick();
    assert.equal((await f.store.list()).length, 2, '一次 tick 最多写两篇');
    await f.diary.tick();
    assert.equal((await f.store.list()).length, 3);
  } finally { await rm(f.stateDir, { recursive: true, force: true }); }
});

test('她惦记的那句话只交给教练一次', async () => {
  const day = '2026-11-15';
  const f = await fixture({ days: [day], now: nowFor(day) });
  try {
    await f.diary.tick();
    const pending = await f.diary.lineForPrompt();
    assert.deepEqual(pending, { day, text: '明天再讲吧' });
    assert.equal(await f.diary.lineForPrompt(), null, '用过就不再给');
  } finally { await rm(f.stateDir, { recursive: true, force: true }); }
});
