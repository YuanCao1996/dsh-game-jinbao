// Build the augment-recognition eval cases from the labelled frame corpus.
//
// Ground truth comes from the game log sidecar (`_truth.json`), not from any model, so a
// case can never inherit a model's mistake. Each frame is assigned to the offer whose
// timestamp is nearest within the window the sidecar declares.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const FRAMES = process.argv[2] ?? 'D:/work/DSH/workspace/media/augment-frames';
const OUT = process.argv[3] ?? 'D:/work/DSH/publish/jinbao-desktop-public/tools/eval/cases/augment-recognition.jsonl';

const truth = JSON.parse(readFileSync(join(FRAMES, '_truth.json'), 'utf8'));
const windowMs = (Number(truth.windowSec) || 15) * 1000;

const parseShotTime = name => {
  const m = /shot_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})/.exec(name);
  if (!m) return NaN;
  // Frames were captured on the same machine, so local time is the only sensible reading.
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}+08:00`).getTime();
};
const offerTime = at => {
  const m = /(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(at);
  if (!m) return NaN;
  return new Date(`2026-${m[1]}-${m[2]}T${m[3]}:${m[4]}:${m[5]}+08:00`).getTime();
};

const offers = truth.offers.map(offer => ({ ...offer, t: offerTime(offer.at) })).filter(o => Number.isFinite(o.t));
const frames = readdirSync(FRAMES).filter(n => n.toLowerCase().endsWith('.png')).sort();

const cases = [];
let unmatched = 0;
for (const name of frames) {
  const t = parseShotTime(name);
  if (!Number.isFinite(t)) { unmatched++; continue; }
  let best = null;
  for (const offer of offers) {
    const d = Math.abs(t - offer.t);
    if (!best || d < best.d) best = { d, offer };
  }
  if (!best || best.d > windowMs) { unmatched++; continue; }
  const path = join(FRAMES, name);
  const bytes = readFileSync(path);
  cases.push({
    id: `augment-${name.replace(/^shot_/, '').replace(/_1920x1080\.png$/, '')}`,
    task: 'augment-recognition',
    // The model must read the three options actually on screen.
    prompt: '读出海克斯三选一面板上的三个强化名称，按从左到右的顺序输出 JSON 数组；看不清的用 null 占位。',
    image: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    ground_truth: { options: best.offer.options, roll: best.offer.roll },
    meta: { source: 'augment-frames', captured_at: new Date(t).toISOString(), offset_ms: best.d, sidecar: '_truth.json' },
    scoring: { type: 'exact-set', fields: ['options'], partial_credit: true },
  });
}

mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, cases.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
const rolls = new Set(cases.map(c => c.ground_truth.roll));
console.log(JSON.stringify({ cases: cases.length, unmatched, offers: offers.length, rolls: [...rolls], out: OUT }, null, 1));
