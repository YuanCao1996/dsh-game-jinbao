// 装备图标：物品 id → CommunityDragon 图标。服务端首次请求时拉取并落盘，
// 之后只读本地；断网/缺图返回 null，界面回退成文字，不影响其他功能。
import {readFileSync} from 'node:fs';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
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
  return {
    has(id) { return validId(id) && !!paths[String(id)]; },
    async get(id) {
      const key = String(id ?? '');
      // 先看磁盘缓存：映射表换版后旧图标仍可继续显示，不必等新下载。
      const cached = validId(key) ? await readCached(key) : null;
      if (cached) return cached;
      if (!validId(key) || !paths[key]) return null;
      if (!inflight.has(key)) inflight.set(key, download(key).finally(() => inflight.delete(key)));
      return inflight.get(key);
    },
  };
}

export const ITEM_ICON_PATHS = bundledPaths;
export const ITEM_ICON_CDN_ROOT = CDN_ROOT;
