// Local review console for the evaluation set.
//
// Purpose: a human must be able to look at an image, correct the ground truth, and save —
// without touching JSONL by hand. Everything here runs on localhost and only reads images
// that already appear in a case file, so it cannot be used to browse the disk.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CASES = join(here, 'cases');
const PAGE = join(here, 'review.html');
const PORT = Number(process.env.EVAL_REVIEW_PORT ?? 3099);

const caseFiles = () => readdirSync(CASES).filter(n => n.endsWith('.jsonl'));

function loadCases() {
  const out = [];
  for (const file of caseFiles()) {
    const lines = readFileSync(join(CASES, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        out.push({ ...JSON.parse(line), _file: file, _line: index });
      } catch { /* skip torn lines */ }
    });
  }
  return out;
}

/** Rewrite one line of one case file atomically. */
function saveCase(file, id, patch) {
  const path = join(CASES, file);
  const lines = readFileSync(path, 'utf8').split('\n');
  let changed = false;
  const next = lines.map(line => {
    if (!line.trim()) return line;
    let row;
    try { row = JSON.parse(line); } catch { return line; }
    if (row.id !== id) return line;
    changed = true;
    // meta must merge, not replace: a reviewer note lives in meta.note.
    const meta = { ...row.meta, ...(patch.meta ?? {}), reviewed_at: new Date().toISOString() };
    const nextRow = { ...row, ...patch, meta };
    delete nextRow.note;
    return JSON.stringify(nextRow);
  });
  if (!changed) throw Error('case not found');
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, next.join('\n'), 'utf8');
  renameSync(tmp, path);
  return true;
}

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = readFileSync(PAGE);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/api/cases') {
      const cases = loadCases().map(c => ({
        id: c.id, task: c.task, status: c.status ?? (c.task === 'unlabeled' ? 'unlabeled' : 'labeled'),
        prompt: c.prompt ?? '', ground_truth: c.ground_truth ?? null, note: c.meta?.note ?? '',
        file: c._file, image: c.image?.path ?? null, scoring: c.scoring ?? null,
        meta: { source: c.meta?.source, captured_at: c.meta?.captured_at, reviewed_at: c.meta?.reviewed_at },
      }));
      return json(res, 200, cases);
    }

    if (req.method === 'GET' && url.pathname === '/img') {
      const want = url.searchParams.get('p') ?? '';
      const allowed = new Set(loadCases().map(c => c.image?.path).filter(Boolean).map(p => resolve(p)));
      const target = resolve(want);
      if (!allowed.has(target) || !existsSync(target)) return json(res, 404, { error: 'image not in cases' });
      const stat = statSync(target);
      if (stat.size > 40 * 1024 * 1024) return json(res, 413, { error: 'image too large' });
      const ext = target.toLowerCase();
      const type = ext.endsWith('.png') ? 'image/png' : ext.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      const bytes = readFileSync(target);
      res.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': 'no-store' });
      return res.end(bytes);
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!body.file || !body.id || !body.patch || typeof body.patch !== 'object') {
        return json(res, 400, { error: 'file, id and patch are required' });
      }
      if (!caseFiles().includes(body.file)) return json(res, 400, { error: 'unknown case file' });
      // Only allow the fields a reviewer is meant to edit.
      const allowedKeys = ['ground_truth', 'status', 'task', 'prompt', 'note'];
      const patch = {};
      for (const key of allowedKeys) if (key in body.patch) patch[key] = body.patch[key];
      if (typeof patch.note === 'string') patch.meta = { ...(patch.meta ?? {}), note: patch.note }, delete patch.note;
      saveCase(body.file, body.id, patch);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      const cases = loadCases();
      const byTask = {};
      for (const c of cases) {
        const t = c.task;
        byTask[t] ??= { total: 0, labeled: 0 };
        byTask[t].total++;
        if ((c.status ?? (t === 'unlabeled' ? 'unlabeled' : 'labeled')) !== 'unlabeled') byTask[t].labeled++;
      }
      return json(res, 200, { total: cases.length, byTask });
    }

    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, { error: String(error?.message ?? error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`评估审核页: http://127.0.0.1:${PORT}/`);
  console.log(`用例目录: ${CASES}`);
});
