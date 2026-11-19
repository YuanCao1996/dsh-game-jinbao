import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeMatch, summaryKey, createMatchSummaryStore } from '../lib/match-summary.js';

const finished = () => ({
  game: 'lol', match: 'lol-live-1.jsonl#1', ended: true, gameSeconds: 1180, at: 1793544604873,
  me: { champion: '齐天大圣', level: 18, gold: 2589, k: 13, d: 12, a: 15 },
  ownedAugments: ['坦克引擎'],
  events: [{ time: '18:21', text: '水晶被摧毁' }],
  chat: [{ role: 'user', text: '怎么打' }],
  broadcasts: [
    { text: '下一件自然之力', topic: undefined },
    { text: '三杀！', topic: 'praise' },
    { text: '过期的那条', revoked: true },
  ],
});

test('unfinished matches produce no summary', () => {
  assert.equal(summarizeMatch({ ...finished(), ended: false }), null);
  assert.equal(summarizeMatch({ ended: true }), null, 'a summary needs a match id');
  assert.equal(summarizeMatch(), null);
});

test('a finished match summarises result, advice quality and activity', () => {
  const s = summarizeMatch(finished());
  assert.equal(s.match, 'lol-live-1.jsonl#1');
  assert.equal(s.game, 'lol');
  assert.equal(s.champion, '齐天大圣');
  assert.equal(s.seconds, 1180);
  assert.deepEqual(s.kda, { k: 13, d: 12, a: 15 });
  assert.deepEqual(s.advice, { published: 3, revoked: 1, spokenPraise: 1 });
  assert.deepEqual(s.chat, { turns: 1 });
  assert.deepEqual(s.events, { count: 1 });
  assert.equal(s.augments, 1);
});

test('the same match is recorded once, even after a restart re-reads the log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-summary-'));
  const store = createMatchSummaryStore(dir);
  const summary = summarizeMatch(finished());
  assert.ok(store.record(summary));
  assert.equal(store.record(summary), null, 'duplicate write is skipped');
  assert.equal(store.count(), 1);

  // A fresh store (simulating a restart) must still see the existing record.
  const reopened = createMatchSummaryStore(dir);
  assert.equal(reopened.record(summary), null, 'replay must not double count');
  assert.equal(reopened.count(), 1);

  const lines = (await readFile(join(dir, 'match-history.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).match, 'lol-live-1.jsonl#1');
});

test('different matches are appended in order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-summary-'));
  const store = createMatchSummaryStore(dir);
  store.record(summarizeMatch({ ...finished(), match: 'a' }));
  store.record(summarizeMatch({ ...finished(), match: 'b' }));
  assert.equal(store.count(), 2);
  assert.equal(summaryKey({ game: 'lol', match: 'a' }), 'lol:a');
});

test('matchWin 布尔值也要落成胜负（客户端只写这个字段）', () => {
  assert.equal(summarizeMatch({ ...finished(), matchWin: true }).result, 'win');
  assert.equal(summarizeMatch({ ...finished(), matchWin: false }).result, 'loss');
  assert.equal(summarizeMatch(finished()).result, null, '不知道就不要编');
  assert.equal(summarizeMatch({ ...finished(), matchWin: true, result: 'loss' }).result, 'loss', '显式 result 优先');
});

test('先落盘没有胜负、之后拿到 GameEnd 结果时补写回同一行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-summary-backfill-'));
  try {
    const store = createMatchSummaryStore(dir);
    const early = summarizeMatch({ ...finished(), matchWin: null });
    assert.equal(early.result, null);
    assert.ok(store.record(early), '第一次先记下来（还没有胜负）');
    assert.equal(store.record(early), null, '重复的不再追加');

    const later = summarizeMatch({ ...finished(), matchWin: true });
    assert.equal(later.result, 'win');
    assert.ok(store.record(later), '拿到胜负后应当补写');

    const rows = (await readFile(join(dir, 'match-history.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(rows.length, 1, '补写不能再加一行');
    assert.equal(JSON.parse(rows[0]).result, 'win');

    const again = createMatchSummaryStore(dir);
    assert.equal(again.record(summarizeMatch({ ...finished(), matchWin: false })), null, '已有胜负就不再改写');
    assert.equal(JSON.parse((await readFile(join(dir, 'match-history.jsonl'), 'utf8')).trim()).result, 'win');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
