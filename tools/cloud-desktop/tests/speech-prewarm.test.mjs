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

test('45 秒静默窗口内的下一条建议会先预合成，窗口一到立即播放', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'jinbao-speech-prewarm-'));
  let time = 10000;
  const calls = [], played = [];
  const view = { game: 'lol', match: 'prewarm', ended: false, updatedAt: time, playback: [] };
  const speech = await createSpeech({
    stateDir,
    view: () => view,
    now: () => time,
    minIntervalMs: 45000,
    synthesize: async text => { calls.push(text); return { mediaType: 'audio/wav', audioBase64: wavBase64() }; },
    play: async audio => { played.push(audio); },
    pause: async ms => { time += ms; view.updatedAt = time; },
  });
  t.after(async () => { await speech.close(); await rm(stateDir, { recursive: true, force: true }); });
  await speech.configure({ enabled: true });

  view.playback.push({ id: 'one', text: '第一条建议。', priority: 1, at: time, expiresAt: time + 45000 });
  speech.tick();
  await speech.settle();
  assert.equal(played.length, 1);

  time += 20000;
  view.updatedAt = time;
  view.playback.push({ id: 'two', text: '第二条建议。', priority: 1, at: time, expiresAt: time + 60000 });
  speech.tick();
  await speech.settle();
  assert.equal(calls.filter(text => text === '第二条建议。').length, 1, '应在静默窗口内预合成');
  assert.equal(played.length, 2, '窗口到达后应播放第二条');
  assert.equal(speech.status().queueDepth, 0);
});
