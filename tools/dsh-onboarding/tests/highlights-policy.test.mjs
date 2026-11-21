import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldCapture, createHighlights, highlightBucket, HIGHLIGHT_KIND_LIMITS } from '../highlights.mjs';

// 11-20 实测：每局 6 张里 5 张是敌方团灭，玩家自己的多杀/首杀一张都没有。
// 这组用例锁住「只留与我有关的瞬间」以及每类名额。

const multikill = (streak) => ({ name: 'Multikill', KillStreak: streak });
const fakeJpeg = { available: true, mediaType: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') };

test('敌方的事件一律不留：多杀/团灭/资源', () => {
  assert.equal(shouldCapture(multikill(5), { side: 'enemy' }), false);
  assert.equal(shouldCapture({ name: 'Ace' }, { side: 'enemy', alive: true }), false);
  assert.equal(shouldCapture({ name: 'FirstBlood' }, { side: 'enemy' }), false);
  assert.equal(shouldCapture({ name: 'BaronKill' }, { side: 'enemy' }), false);
});

test('自己的多杀三杀起才留；队友只有四杀/五杀才留', () => {
  assert.equal(shouldCapture(multikill(2), { side: 'self' }), false);
  assert.equal(shouldCapture(multikill(3), { side: 'self' }), true);
  assert.equal(shouldCapture(multikill(5), { side: 'self' }), true);
  assert.equal(shouldCapture(multikill(3), { side: 'ally' }), false);
  assert.equal(shouldCapture(multikill(4), { side: 'ally' }), true);
});

test('团灭要求你当时活着（死了是黑白复活屏）', () => {
  assert.equal(shouldCapture({ name: 'Ace' }, { side: 'ally', alive: false }), false);
  assert.equal(shouldCapture({ name: 'Ace' }, { side: 'self', alive: true }), true);
  assert.equal(shouldCapture({ name: 'Ace' }, { side: 'unknown', alive: false }), false);
});

test('首杀只留自己拿的', () => {
  assert.equal(shouldCapture({ name: 'FirstBlood' }, { side: 'ally' }), false);
  assert.equal(shouldCapture({ name: 'FirstBlood' }, { side: 'self' }), true);
});

test('认不出归属时按「可能是我方」处理，不会误挡', () => {
  assert.equal(shouldCapture(multikill(3), { side: 'unknown' }), true);
  assert.equal(shouldCapture({ name: 'FirstBlood' }, { side: 'unknown' }), true);
});

test('每类名额：团灭 2、多杀 3、首杀 1，资源合计算 2', () => {
  assert.equal(HIGHLIGHT_KIND_LIMITS.Ace, 2);
  assert.equal(HIGHLIGHT_KIND_LIMITS.Multikill, 3);
  assert.equal(HIGHLIGHT_KIND_LIMITS.FirstBlood, 1);
  assert.equal(highlightBucket('InhibKilled'), 'objective');
  assert.equal(highlightBucket('BaronKill'), 'objective');
  assert.equal(highlightBucket('DragonKill'), 'objective');
});

test('连续三次团灭只留下两张（名额生效）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hl-quota-'));
  let clock = 1_000_000;
  const shots = await createHighlights({ stateDir: dir, capture: async () => fakeJpeg, now: () => clock });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = [];
  for (let i = 0; i < 3; i += 1) {
    clock += 60_000;
    result.push(await shots.maybeCapture({ event: { name: 'Ace' }, game: 'lol', match: 'm1', side: 'self', alive: true }));
  }
  assert.equal(result[0] !== null, true, '第一张应该留下');
  assert.equal(result[1] !== null, true, '第二张应该留下');
  assert.equal(result[2], null, '第三张应被名额挡住');
});

test('敌方的画面不会占用名额（自己的后面还能拍）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hl-enemy-'));
  let clock = 1_000_000;
  const shots = await createHighlights({ stateDir: dir, capture: async () => fakeJpeg, now: () => clock });
  t.after(() => rm(dir, { recursive: true, force: true }));

  for (let i = 0; i < 3; i += 1) {
    clock += 60_000;
    assert.equal(await shots.maybeCapture({ event: { name: 'Ace' }, game: 'lol', match: 'm1', side: 'enemy', alive: false }), null);
  }
  clock += 60_000;
  const mine = await shots.maybeCapture({ event: { name: 'Multikill', KillStreak: 4 }, game: 'lol', match: 'm1', side: 'self', alive: true });
  assert.ok(mine, '敌方画面不该占掉名额');
});
