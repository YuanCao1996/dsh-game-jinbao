// Evaluation capture hook, shipped inside the coach plugin so it is available on the host line.
//
// Gate: only runs when JINBAO_EVAL_CAPTURE=1. That flag belongs to development and internal
// builds; a production install never writes frames, because screenshots contain player names.
//
// The pair format matches tools/eval (PNG + JSON sidecar, same basename) so the review console
// can pick it up directly.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const FLAG = 'JINBAO_EVAL_CAPTURE';

/** Capture pairing is opt-in per process; never inferred from NODE_ENV. */
export function evalCaptureEnabled(env = process.env) {
  return String(env?.[FLAG] ?? '') === '1';
}

const stamp = at => {
  const d = new Date(at);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${String(d.getMilliseconds()).padStart(3, '0')}`;
};

/** Facts we are willing to persist: bounded, no free-form user text. */
export function captureFacts(state = {}, { game, match } = {}) {
  const me = state.me ?? {};
  const pickNumber = value => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    game: state.game ?? game ?? null,
    match: state.match ?? match ?? null,
    gameSeconds: pickNumber(state.gameSeconds),
    phase: typeof state.phase === 'string' ? state.phase : null,
    me: {
      champion: typeof me.champion === 'string' ? me.champion : null,
      level: pickNumber(me.level),
      k: pickNumber(me.k), d: pickNumber(me.d), a: pickNumber(me.a),
      gold: pickNumber(me.gold),
    },
    ownedAugments: Array.isArray(state.ownedAugments) ? state.ownedAugments.slice(0, 12) : [],
    offeredAugments: Array.isArray(state.offeredAugments) ? state.offeredAugments.slice(0, 6) : [],
    ended: state.ended === true,
  };
}

const hashesByDir = new Map();
function knownHashes(dir) {
  if (hashesByDir.has(dir)) return hashesByDir.get(dir);
  const set = new Set();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const side = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        if (side.sha256) set.add(side.sha256);
      } catch { /* torn sidecar */ }
    }
  }
  hashesByDir.set(dir, set);
  return set;
}

/**
 * Write one pair. Returns null when capture pairing is disabled.
 *
 * @param {object} options
 * @param {string} options.stateDir  state directory; pairs go to <stateDir>/capture-pairs
 * @param {Buffer} options.image     JPEG/PNG bytes
 * @param {object} options.facts     facts true at capture time
 * @param {number} [options.at]
 * @param {string} [options.source]  'host' | 'standalone'
 */
export function maybeSavePair({ stateDir, image, facts, at = Date.now(), source = 'host', env = process.env } = {}) {
  if (!evalCaptureEnabled(env) || !stateDir || !image?.length || !facts) return null;
  return savePair({ dir: join(stateDir, 'capture-pairs'), image, facts, at, source });
}

export function savePair({ dir, image, facts, at = Date.now(), source = 'unknown' } = {}) {
  if (!dir) throw Error('dir is required');
  if (!image?.length) return { written: false, reason: 'empty_image' };
  if (!facts || typeof facts !== 'object') return { written: false, reason: 'facts_required' };

  const sha = createHash('sha256').update(image).digest('hex');
  mkdirSync(dir, { recursive: true });
  if (knownHashes(dir).has(sha)) return { written: false, reason: 'duplicate_frame' };

  const base = `${stamp(at)}_${sha.slice(0, 8)}`;
  const png = join(dir, `${base}.png`);
  const json = join(dir, `${base}.json`);
  writeFileSync(png, image);
  writeFileSync(json, JSON.stringify({
    at: new Date(at).toISOString(),
    source,
    sha256: sha,
    bytes: image.length,
    facts,
    candidate_tasks: facts.offeredAugments?.length ? ['augment-recognition']
      : facts.me?.champion ? ['hero-recognition', 'scene-understanding', 'strategy-advice']
      : ['scene-understanding'],
  }, null, 2), { mode: 0o600 });
  knownHashes(dir).add(sha);
  return { written: true, png, json };
}
