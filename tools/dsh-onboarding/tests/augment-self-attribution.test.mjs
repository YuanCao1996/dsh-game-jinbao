import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatObserver } from '../../lol-companion/chat-observer.mjs';
import { applyOverlayEvent, initialOverlayState } from '../overlay-state.mjs';

// 2026-11-12 狂厄蔷薇那局的完整链路回归：
// 客户端公告写成「你 已质变了 X」→ 归属必须是自己 → 本局已选必须有它。
const NAMES = ['双刀流', '秘术冲拳', '大法师'];
const catalog = { champions: [{ name: '狂厄蔷薇', alias: 'Briar' }], items: [] };
const poly = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function stamp(events) {
  const base = Date.now();
  return events.map((event, index) => ({ game: 'lol', t: base + index, ...event }));
}

function chatEvents(lines, meState) {
  const events = [];
  const observer = createChatObserver(NAMES, (event) => events.push(event));
  observer.setCatalog(catalog);
  observer.observe({ available: true, foreground: true, width: 1920, height: 1080, lines }, meState);
  return events;
}

test('聊天公告里的「你」→ 归属自己 → 进入本局已选', () => {
  const meState = { gameSeconds: 195, me: { champion: '狂厄蔷薇', championAlias: 'Briar' }, allies: [], enemies: [] };
  const events = stamp(chatEvents([{ box: poly(20, 700, 320, 22), text: '你 已质变了 双刀流' }], meState));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'augment_mutate');
  assert.equal(events[0].who, 'self');
  assert.equal(events[0].augment, '双刀流');

  const state = initialOverlayState();
  state.game = 'lol';
  state.match = 'lol-live-test.jsonl#1';
  state.at = Date.now();
  state.gameSeconds = 195;
  state.me = { champion: '狂厄蔷薇', championAlias: 'Briar' };
  state.allies = [];
  state.enemies = [];
  for (const event of events) applyOverlayEvent(state, event, 'lol-live-test.jsonl');
  assert.ok(state.ownedAugments.includes('双刀流'), '自己选的强化必须进入本局已选，实际: ' + JSON.stringify(state.ownedAugments));
});

test('别人的公告（带英雄名）不会算到自己头上', () => {
  const meState = { gameSeconds: 200, me: { champion: '狂厄蔷薇', championAlias: 'Briar' }, allies: [], enemies: [] };
  const events = stamp(chatEvents([{ box: poly(20, 700, 320, 22), text: '迅捷斥候 已质变了 大法师' }], meState));
  assert.equal(events.length, 1);
  assert.notEqual(events[0].who, 'self', '别人的公告不能算成自己');

  const state = initialOverlayState();
  state.game = 'lol';
  state.match = 'lol-live-test.jsonl#1';
  state.at = Date.now();
  state.me = { champion: '狂厄蔷薇', championAlias: 'Briar' };
  state.allies = [];
  state.enemies = [];
  for (const event of events) applyOverlayEvent(state, event, 'lol-live-test.jsonl');
  assert.ok(!state.ownedAugments.includes('大法师'), '别人的强化不能进本局已选');
});

// 闭环：日志里的 augment_mutate(自己) → 对局回忆的 augments。
// 2026-11-12 那局回忆里 augments 为空，正是因为归因链路断在「你」上。
test('回忆里必须记录本局已选海克斯', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aug-memory-'));
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const rows = [
    { game: 'lol', t: 1, kind: 'state', state: { me: { champion: '狂厄蔷薇', championAlias: 'Briar', riotId: 'Tester#1', k: 3, d: 1, a: 5, level: 11, cs: 20, items: [] } } },
    { game: 'lol', t: 2, kind: 'augment_mutate', augment: '双刀流', champion: '狂厄蔷薇', who: 'self', source: 'log-confirmed', confidence: 'high' },
    { game: 'lol', t: 3, kind: 'event', name: 'GameEnd', EventTime: 600, Result: 'Win' },
  ];
  writeFileSync(join(dir, 'logs', 'lol-live-test.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));

  const mod = await import('../exploration-local.mjs');
  const catalog = JSON.parse(readFileSync(new URL('../exploration-catalog.json', import.meta.url), 'utf8'));
  const ex = mod.createLocalExploration({ stateDir: dir, catalog });
  await ex.recordMatch({
    game: 'lol', mode: 'KIWI', match: 'lol-live-test.jsonl#1',
    matchStartedAt: Date.now() - 600000, ended: true, phase: 'EndOfGame',
    selfChampion: '狂厄蔷薇', liveStats: { clock: '10:00' },
  });

  const store = JSON.parse(readFileSync(join(dir, 'exploration', 'records.json'), 'utf8'));
  const row = (store.matches ?? []).at(-1);
  assert.ok(row, '应写入一条对局回忆');
  assert.ok(Array.isArray(row.augments) && row.augments.includes('双刀流'),
    '回忆必须记录本局已选海克斯，实际: ' + JSON.stringify(row.augments));
  assert.equal(row.win, true);
  assert.deepEqual(row.kda, [3, 1, 5]);
});
