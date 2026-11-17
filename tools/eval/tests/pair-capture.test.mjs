import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePair, maybeSavePair, captureFacts, evalCaptureEnabled } from '../pair-capture.mjs';

const png = Buffer.from('89504e470d0a1a0a fake png bytes', 'utf8');

test('capture pairing is off unless the internal flag is set', async () => {
  assert.equal(evalCaptureEnabled({}), false);
  assert.equal(evalCaptureEnabled({ JINBAO_EVAL_CAPTURE: '0' }), false);
  assert.equal(evalCaptureEnabled({ JINBAO_EVAL_CAPTURE: '1' }), true);

  const stateDir = await mkdtemp(join(tmpdir(), 'jinbao-gate-'));
  assert.equal(maybeSavePair({ stateDir, image: png, facts: { game: 'lol' }, env: {} }), null);
  assert.deepEqual(await readdir(stateDir), [], 'a disabled hook must not create files');
});

test('the internal flag writes a pair under the state directory', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'jinbao-gate-'));
  const result = maybeSavePair({ stateDir, image: png, facts: { game: 'lol', match: 'm1' }, source: 'host', env: { JINBAO_EVAL_CAPTURE: '1' } });
  assert.equal(result?.written, true);
  const names = (await readdir(join(stateDir, 'capture-pairs'))).sort();
  assert.equal(names.length, 2);
});

test('a pair writes the image and a sidecar with the same basename', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-pair-'));
  const result = savePair({ dir, image: png, facts: { game: 'lol', match: 'm1', me: { champion: '永恩' } }, at: Date.UTC(2026, 10, 17, 5, 0, 0), source: 'host' });
  assert.equal(result.written, true);

  const names = (await readdir(dir)).sort();
  assert.equal(names.length, 2);
  const base = names[0].replace(/\.(png|json)$/, '');
  assert.equal(names[1].replace(/\.(png|json)$/, ''), base, 'png and json must share a basename');

  const side = JSON.parse(await readFile(join(dir, `${base}.json`), 'utf8'));
  assert.equal(side.facts.match, 'm1');
  assert.equal(side.source, 'host');
  assert.match(side.sha256, /^[0-9a-f]{64}$/);
});

test('an identical frame is skipped instead of stored twice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-pair-'));
  const facts = { game: 'lol', match: 'm1' };
  assert.equal(savePair({ dir, image: png, facts }).written, true);
  const second = savePair({ dir, image: png, facts });
  assert.equal(second.written, false);
  assert.equal(second.reason, 'duplicate_frame');
  assert.equal((await readdir(dir)).length, 2, 'still only one pair on disk');
});

test('facts are required and never invented', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-pair-'));
  assert.equal(savePair({ dir, image: png }).reason, 'facts_required');
  assert.equal(savePair({ dir, image: Buffer.alloc(0), facts: {} }).reason, 'empty_image');
  assert.equal((await readdir(dir)).length, 0);
});

test('facts projection keeps only bounded, non-user-text fields', () => {
  const facts = captureFacts({
    game: 'lol', match: 'm1', gameSeconds: 449.6, phase: 'InProgress',
    me: { champion: '齐天大圣', level: 18, k: 13, d: 12, a: 15, gold: 2589, kdaText: '13/12/15' },
    ownedAugments: new Array(20).fill('坦克引擎'),
    offeredAugments: ['A', 'B', 'C'],
    chat: [{ text: '用户说了一堆话' }],
    ended: false,
  });
  assert.equal(facts.gameSeconds, 449.6);
  assert.equal(facts.me.champion, '齐天大圣');
  assert.equal(facts.ownedAugments.length, 12, 'augment list is capped');
  assert.equal('chat' in facts, false, 'free-form user text must never be captured');
  assert.equal('kdaText' in facts.me, false);
});

test('an augment frame is hinted as an augment case, a champion frame as hero', () => {
  const augment = captureFacts({ offeredAugments: ['A', 'B', 'C'] });
  const hero = captureFacts({ me: { champion: '永恩' } });
  assert.ok(augment.offeredAugments.length);
  assert.equal(hero.me.champion, '永恩');
});
