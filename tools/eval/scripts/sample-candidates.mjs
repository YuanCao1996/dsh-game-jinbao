// Sample unlabelled images into a candidate manifest for manual labelling.
//
// Candidates are deliberately NOT ground truth: a model must never grade its own homework.
// A human reads the image, fills `ground_truth`, flips `status` to "labeled", and the case
// can then move into cases/.

import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const limit = Number(process.argv[3] ?? 200);
const out = process.argv[4] ?? 'cases/candidates.jsonl';

if (!root) throw Error('usage: sample-candidates.mjs <image dir> <count> <out.jsonl>');

// Deterministic sampling: sort then stride, so re-running yields the same manifest.
const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (/\.(png|jpe?g)$/i.test(name) && st.size > 20000) files.push({ path, size: st.size, mtime: st.mtimeMs });
  }
};
walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const stride = Math.max(1, Math.floor(files.length / limit));
const picked = [];
for (let i = 0; i < files.length && picked.length < limit; i += stride) picked.push(files[i]);

mkdirSync(join(out, '..'), { recursive: true });
const lines = picked.map(f => JSON.stringify({
  id: `candidate-${createHash('sha256').update(f.path).digest('hex').slice(0, 12)}`,
  task: 'unlabeled',
  status: 'unlabeled',
  image: {
    path: f.path,
    sha256: createHash('sha256').update(readFileSync(f.path)).digest('hex'),
    bytes: f.size,
  },
  meta: { source: root, mtime: new Date(f.mtime).toISOString() },
  // Fill these in when labelling:
  ground_truth: null,
  note: '标注要求：hero-recognition 填双方英雄；augment-recognition 填三个选项；strategy-advice 留空只写 rubric。',
}));
writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ scanned: files.length, picked: picked.length, stride, out }, null, 1));
