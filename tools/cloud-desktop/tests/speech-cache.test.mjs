import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSpeech } from '../speech.mjs';

function wavBase64() {
  const b = Buffer.alloc(64);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(56, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(22050, 24);
  b.writeUInt32LE(44100, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(20, 40);
  return b.toString('base64');
}

test('同一角色同一句话第二次直接读缓存，不再调用合成', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'jinbao-speech-cache-'));
  let time = 10000;
  let calls = 0;
  const view = { game: 'lol', match: 'cache', ended: false, updatedAt: time, playback: [] };
  const speech = await createSpeech({
    stateDir,
    view: () => view,
    now: () => time,
    minIntervalMs: 0,
    synthesize: async () => { calls += 1; return { mediaType: 'audio/wav', audioBase64: wavBase64() }; },
    play: async () => {},
  });
  t.after(async () => { await speech.close(); await rm(stateDir, { recursive: true, force: true }); });
  await speech.configure({ enabled: true });

  view.playback.push({ id: 'a', text: '缓存测试。', priority: 1, at: time, expiresAt: time + 45000 });
  speech.tick();
  await speech.settle();

  time += 61000;
  view.updatedAt = time;
  view.playback.push({ id: 'b', text: '缓存测试。', priority: 1, at: time + 100, expiresAt: time + 50000 });
  speech.tick();
  await speech.settle();

  assert.equal(calls, 1, '第二次应命中缓存');
  assert.equal(speech.status().cacheHits, 1);
});
