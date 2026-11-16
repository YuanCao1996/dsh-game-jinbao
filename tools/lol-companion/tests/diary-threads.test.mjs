import test from 'node:test';
import assert from 'node:assert/strict';
import { promiseThreads, lineThread, mergeThreads, dueThreads, insightFor } from '../diary-threads.mjs';

const day = 86400e3;
const at = (y, m, d, hh = 21) => new Date(y, m - 1, d, hh, 0, 0, 0).getTime();

test('只把玩家真的说过的「下次……」记成未了线', () => {
  const threads = promiseThreads(['明天换个出装试试', '这波我C', '等下我先去推线', '好'], '2026-11-15');
  assert.equal(threads.length, 2, JSON.stringify(threads));
  assert.equal(threads[0].kind, 'promise');
  assert.ok(threads.every(thread => thread.day === '2026-11-15' && thread.id.length === 16));
  assert.deepEqual(promiseThreads([], '2026-11-15'), []);
});

test('日记里那句话也算一条未了线', () => {
  const threads = lineThread({ day: '2026-11-15', line: '明天再讲吧' });
  assert.equal(threads.length, 1);
  assert.deepEqual([threads[0].kind, threads[0].text], ['line', '明天再讲吧']);
  assert.deepEqual(lineThread({ day: '2026-11-15' }), []);
});

test('合并去重，且用过的标记不会被洗掉', () => {
  const merged = mergeThreads(
    [{ id: 'a', text: '明天换个出装', kind: 'promise', at: 1, usedAt: 99 }],
    [{ id: 'a', text: '明天换个出装', kind: 'promise', at: 2 }, { id: 'b', text: '下次先出鞋', kind: 'promise', at: 3 }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].usedAt, 99, '已经用过的不能被新记录洗掉');
  assert.equal(merged[0].at, 2, '时间戳用新的');
});

test('到期规则：没用过、不太旧、一周最多两次', () => {
  const now = at(2026, 11, 16);
  const threads = [
    { id: 'a', text: '旧话', at: now - 40 * day },
    { id: 'b', text: '新话', at: now - 2 * day },
    { id: 'c', text: '用过的话', at: now - day, usedAt: now - 1000 },
  ];
  assert.deepEqual(dueThreads(threads, { now }).map(thread => thread.id), ['b'], '太旧的不提，用过的不提');
  assert.deepEqual(dueThreads([{ id: 'x', text: '一', at: now - day }, { id: 'y', text: '二', at: now - day }, { id: 'z', text: '三', at: now - day }], { now, weekLimit: 2 }).length, 3);
  assert.deepEqual(dueThreads([
    { id: 'x', text: '一', at: now - day, usedAt: now - day },
    { id: 'y', text: '二', at: now - day, usedAt: now - 2 * day },
    { id: 'z', text: '三', at: now - day },
  ], { now }).length, 0, '一周已经用过两次就闭嘴');
});

test('周回顾的洞察：样本不够就不说，够了才说规律', () => {
  const now = at(2026, 11, 16);
  const few = [{ at: now - day, result: 'lose' }, { at: now - day, result: 'win' }];
  assert.equal(insightFor(few, { now }), null);

  // 连输两场之后的那一局：赢 4 次、输 1 次 → 说得出口
  const rows = [];
  let stamp = now - 6 * day;
  for (let round = 0; round < 5; round++) {
    rows.push({ at: stamp += 600e3, result: 'lose' });
    rows.push({ at: stamp += 600e3, result: 'lose' });
    rows.push({ at: stamp += 600e3, result: round < 4 ? 'win' : 'lose' });
  }
  const insight = insightFor(rows, { now });
  assert.match(insight, /连输两场/);
  assert.match(insight, /4\/5/);

  // 全部是赢家：没有规律可说，就不要硬编
  const flat = Array.from({ length: 8 }, (_, index) => ({ at: now - index * 600e3, result: 'win' }));
  assert.equal(insightFor(flat, { now }), null);
});
