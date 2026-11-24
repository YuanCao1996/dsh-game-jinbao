// 装备图标：物品 id → CommunityDragon 图标。服务端首次请求时拉取并落盘，
// 之后只读本地；断网/缺图返回 null，界面回退成文字，不影响其他功能。
import {readFileSync} from 'node:fs';
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const CDN_ROOT = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
const bundledPaths = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./item-icon-paths.json', import.meta.url), 'utf8'));
  } catch { return {}; }
})();

const validId = value => /^\d{1,8}$/.test(String(value ?? ''));
const safeType = value => /^image\/(?:png|jpeg|webp)$/i.test(String(value ?? '')) ? String(value).toLowerCase() : 'image/png';

export function createItemIconStore({stateDir, fetchImpl=fetch, paths=bundledPaths}={}) {
  const dir = join(stateDir, 'item-icons');
  const memory = new Map();
  const inflight = new Map();
  async function readCached(id) {
    if (memory.has(id)) return memory.get(id);
    try {
      const bytes = await readFile(join(dir, id + '.png'));
      if (bytes.length > 0 && bytes.length <= 200 * 1024) {
        const value = {bytes, type: 'image/png'};
        memory.set(id, value);
        return value;
      }
    } catch {}
    return null;
  }
  async function download(id) {
    const path = paths[id];
    if (!path) return null;
    try {
      const response = await fetchImpl(CDN_ROOT + path, {redirect: 'error', signal: AbortSignal.timeout(15000)});
      if (!response.ok) { await response.body?.cancel?.(); return null; }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 200 * 1024) return null;
      const value = {bytes, type: safeType(response.headers?.get?.('content-type'))};
      try {
        await mkdir(dir, {recursive: true});
        const tmp = join(dir, id + '.' + process.pid + '.tmp');
        await writeFile(tmp, bytes, {mode: 0o600});
        await rename(tmp, join(dir, id + '.png'));
      } catch {}
      memory.set(id, value);
      return value;
    } catch { return null; }
  }
  async function cachedIds() {
    const ids = new Set();
    try { for (const name of await readdir(dir)) if (/^\d{1,8}\.png$/.test(name)) ids.add(name.slice(0, -4)); } catch {}
    return ids;
  }
  async function get(id) {
    const key = String(id ?? '');
    // 先看磁盘缓存：映射表换版后旧图标仍可继续显示，不必等新下载。
    const cached = validId(key) ? await readCached(key) : null;
    if (cached) return cached;
    if (!validId(key) || !paths[key]) return null;
    if (!inflight.has(key)) inflight.set(key, download(key).finally(() => inflight.delete(key)));
    return inflight.get(key);
  }
  // 提前采集：空闲时把映射里的图标全部缓存到本地。失败到一定次数就停手，
  // 避免断网时反复打 CDN；已缓存的会跳过，所以下次启动可以接着补。
  async function prefetch({concurrency=3, spacingMs=20, stopAfterFailures=8, shouldStop, onProgress}={}) {
    const cached = await cachedIds();
    const ids = Object.keys(paths).filter(id => validId(id) && !cached.has(id));
    let next = 0, added = 0, failed = 0, consecutiveFailures = 0, stopped = false;
    const total = ids.length;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const worker = async () => {
      while (!stopped) {
        if (typeof shouldStop === 'function') { try { if (shouldStop()) { stopped = true; break; } } catch {} }
        const index = next++;
        if (index >= ids.length) return;
        const id = ids[index];
        const value = await get(id);
        if (value) { added += 1; consecutiveFailures = 0; }
        else {
          failed += 1; consecutiveFailures += 1;
          if (consecutiveFailures >= stopAfterFailures) { stopped = true; break; }
        }
        onProgress?.({done: added + failed, added, failed, total});
        if (spacingMs > 0) await sleep(spacingMs);
      }
    };
    await Promise.all(Array.from({length: Math.min(Math.max(1, concurrency), Math.max(1, ids.length))}, worker));
    return {total, added, failed, stopped, cached: cached.size};
  }
  return {
    has(id) { return validId(id) && !!paths[String(id)]; },
    get,
    prefetch,
    async cachedCount() { return (await cachedIds()).size; },
  };
}

export const ITEM_ICON_PATHS = bundledPaths;
export const ITEM_ICON_CDN_ROOT = CDN_ROOT;
