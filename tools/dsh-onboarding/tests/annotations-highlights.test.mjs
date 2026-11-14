import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnnotations, ANNOTATION_TAGS } from '../annotations.mjs';
import { createHighlights, shouldCapture, matchFolder, HIGHLIGHT_LIMIT_PER_MATCH } from '../highlights.mjs';

// ── 批注：追加式，不改历史
test('批注可以追加，并按对局与英雄查询', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'anno-'));
  const store = createAnnotations({ stateDir });
  await store.add({ match: 'm1#1', champion: '不屈之枪', text: '这局别老让我出肉', tags: ['想打输出'], sentiment: 'negative' });
  await store.add({ match: 'm1#1', champion: '不屈之枪', text: '讲得挺清楚', tags: ['很有用'], sentiment: 'positive' });
  await store.add({ match: 'm2#1', champion: '亚恒', text: '别念英文', tags: ['别念英文'] });

  const forMatch = await store.list({ match: 'm1#1' });
  assert.equal(forMatch.length, 2);
  assert.equal(forMatch[0].text, '这局别老让我出肉');
  assert.deepEqual(forMatch[0].tags, ['想打输出']);

  const forChampion = await store.list({ champion: '亚恒' });
  assert.equal(forChampion.length, 1);
  assert.equal(await store.count('不屈之枪'), 2);
});

test('批注拒绝空内容与未知标签', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'anno2-'));
  const store = createAnnotations({ stateDir });
  await assert.rejects(() => store.add({ match: 'm1#1', text: '   ', tags: [] }), /不能为空/);
  await assert.rejects(() => store.add({ text: '缺对局', tags: [] }), /缺少对局标识/);
  const entry = await store.add({ match: 'm1#1', text: 'ok', tags: ['臆造标签', '很有用'] });
  assert.deepEqual(entry.tags, ['很有用'], '未知标签应被丢弃');
});

test('批注目标默认整局，非法类型回落到整局', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'anno3-'));
  const store = createAnnotations({ stateDir });
  const entry = await store.add({ match: 'm1#1', text: 'x', target: { kind: 'weird', id: 'abc' } });
  assert.equal(entry.target.kind, 'match');
});

// ── 高光截图
test('只有关键事件才截图，多杀要求 3 杀以上', () => {
  assert.equal(shouldCapture({ name: 'Ace' }), true);
  assert.equal(shouldCapture({ name: 'InhibKilled' }), true);
  assert.equal(shouldCapture({ name: 'Multikill', KillStreak: 2 }), false);
  assert.equal(shouldCapture({ name: 'Multikill', KillStreak: 3 }), true);
  assert.equal(shouldCapture({ name: 'ChampionKill' }), false);
});

test('对局标识会被清成安全目录名', () => {
  assert.equal(matchFolder('lol-live-1794585880045.jsonl#1'), 'lol-live-1794585880045.jsonl');
  assert.equal(matchFolder('a/b#2'), 'a_b');
  assert.equal(matchFolder(''), 'unknown');
});

test('每局最多 6 张，且相邻两张至少隔 10 秒', async () => {
  let clock = 1_000_000;
  const frames = [];
  const store = createHighlights({
    stateDir: mkdtempSync(join(tmpdir(), 'hl-')),
    now: () => clock,
    capture: async () => ({ available: true, mediaType: 'image/jpeg', data: Buffer.from('jpegdata').toString('base64') }),
  });
  const event = { name: 'Ace' };
  const first = await store.maybeCapture({ event, game: 'lol', match: 'm1#1', gameSeconds: 100 });
  assert.ok(first, '第一张应当截到');
  clock += 5_000;
  assert.equal(await store.maybeCapture({ event, game: 'lol', match: 'm1#1', gameSeconds: 120 }), null, '10 秒内不再截');
  clock += 10_000;
  let count = 1;
  while (count < HIGHLIGHT_LIMIT_PER_MATCH + 2) {
    clock += 11_000;
    const shot = await store.maybeCapture({ event, game: 'lol', match: 'm1#1', gameSeconds: 200 + count });
    if (shot) count += 1;
    else break;
  }
  assert.equal(count, HIGHLIGHT_LIMIT_PER_MATCH, '上限 6 张');
  const rows = await store.list('m1#1');
  assert.equal(rows.length, HIGHLIGHT_LIMIT_PER_MATCH);
  assert.equal(rows[0].label, '团灭');
});

test('关闭开关时不截图', async () => {
  const store = createHighlights({
    stateDir: mkdtempSync(join(tmpdir(), 'hl2-')),
    enabled: () => false,
    capture: async () => ({ available: true, mediaType: 'image/jpeg', data: 'x' }),
  });
  assert.equal(await store.maybeCapture({ event: { name: 'Ace' }, game: 'lol', match: 'm1#1', gameSeconds: 10 }), null);
});
