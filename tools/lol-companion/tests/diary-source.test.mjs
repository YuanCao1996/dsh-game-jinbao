import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDay, chatLine, resultOf, availableDays } from '../diary-source.mjs';
import { dayKey } from '../diary-day.mjs';

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
const line = value => JSON.stringify(value) + '\n';

test('只挑那一天里真实发生的事，并把玩家自己打的字取出来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-diary-source-'));
  try {
    await mkdir(join(dir, 'game-memory'), { recursive: true });
    await mkdir(join(dir, 'highlights'), { recursive: true });
    await mkdir(join(dir, 'diary'), { recursive: true });
    const day = '2026-11-15';
    await writeFile(join(dir, 'game-memory/match-history.jsonl'), [
      line({ at: at(2026, 11, 14, 20, 0), match: 'lol-live-1.jsonl#1', game: 'lol', champion: '亚索', result: 'lose', seconds: 900, kda: { k: 2, d: 9, a: 3 }, advice: { published: 2, revoked: 1 } }),
      line({ at: at(2026, 11, 15, 21, 0), match: 'lol-live-2.jsonl#1', game: 'lol', champion: '星籁歌姬', result: 'win', seconds: 992, kda: { k: 6, d: 10, a: 49 }, augments: 2 }),
      line({ at: at(2026, 11, 15, 22, 30), match: 'lol-live-3.jsonl#1', game: 'lol', champion: '安妮', result: null, seconds: 600 }),
    ].join(''));
    await writeFile(join(dir, 'highlights/index.jsonl'), [
      line({ at: at(2026, 11, 15, 21, 30), kind: 'Ace', label: '团灭' }),
      line({ at: at(2026, 11, 14, 21, 30), kind: 'Ace', label: '团灭' }),
    ].join(''));
    await writeFile(join(dir, 'local-moments.jsonl'), [
      line({ at: at(2026, 11, 15, 21, 1), kind: 'local-moment', key: 'opening', broadcast: '来啦！这局冲鸭' }),
    ].join(''));
    await writeFile(join(dir, 'diary/questions-2026-11-15.jsonl'), '{}\n{}\n');
    const query = async ({ match }) => ({
      rows: match === 'lol-live-2.jsonl#1'
        ? [{ event: { kind: 'chat_events', events: [
            { kind: 'team_chat', text: '打野来下路', self: true },
            { kind: 'team_chat', text: '队友说的', self: false },
            { kind: 'team_chat', text: '你：别急，我来了', self: true },
          ] } }]
        : [],
    });
    const facts = await collectDay({ stateDir: dir, day, query });
    assert.equal(facts.matches.length, 2);
    assert.equal(facts.wins, 1);
    assert.equal(facts.losses, 0);
    assert.deepEqual(facts.selfChats, ['打野来下路', '别急，我来了'], '只收自己打的字，并去掉「你：」前缀');
    assert.equal(facts.aces, 1, '只算当天的团灭');
    assert.deepEqual(facts.aceLabels, ['团灭']);
    assert.deepEqual(facts.herLines, ['来啦！这局冲鸭']);
    assert.equal(facts.appChats, 2);
    assert.equal(facts.gapDays, 1, '前一天也在玩，隔一天');
    assert.equal(facts.ignoredAdvice, 0);
    assert.deepEqual(await availableDays({ stateDir: dir }), ['2026-11-14', '2026-11-15']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('没有对局也没有聊天时是空的一天，不会编造', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-diary-empty-'));
  try {
    const facts = await collectDay({ stateDir: dir, day: dayKey(at(2026, 11, 15, 12, 0)) });
    assert.equal(facts.matches.length, 0);
    assert.equal(facts.selfChats.length, 0);
    assert.equal(facts.aces, 0);
    assert.equal(facts.appChats, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('聊天行去掉说话人和换行，胜负只认两种情况', () => {
  assert.equal(chatLine('你：别急\n我来了'), '别急 我来了');
  assert.equal(chatLine('打野来下路'), '打野来下路');
  assert.equal(chatLine('x'.repeat(60)).length, 40);
  assert.equal(resultOf('win'), 'win');
  assert.equal(resultOf('victory'), 'win');
  assert.equal(resultOf('defeat'), 'lose');
  assert.equal(resultOf(null), null);
  assert.equal(resultOf('unknown'), null);
});
