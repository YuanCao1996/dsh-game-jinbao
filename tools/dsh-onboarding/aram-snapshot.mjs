// 大乱斗英雄胜率是「每日快照」数据：服务器整份数据是固定的，没必要每局按英雄去检索。
// 本模块把整份榜单提前拉到一个本地文件里，对局中十人胜率直接本地查表，零网络等待。
// 检索接口没有「导出全表」的方法，只能按英雄名查询；本地 roster 里已有全部英雄称号，
// 所以启动后空闲时按名单预取一次（约 170 条、5 秒内完成），之后每天最多刷新一次。
import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

export const ARAM_SNAPSHOT_TTL_MS = 20 * 60 * 60 * 1000;
export const ARAM_SNAPSHOT_FILE = 'aram-ranking-snapshot.json';

export const normalizeChampionKey = value => String(value ?? '')
  .replace(/[\s·・()（）]/g, '')
  .toLowerCase();

function indexKeys(row) {
  const keys = new Set();
  for (const value of [row.key, row.title, row.name, row.en, row.alias]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    // alias 里常是「人马 蛤蟆」这种多个口语名，逐个建索引。
    for (const part of value.split(/[\s,，、/|]+/)) {
      const key = normalizeChampionKey(part);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export function createAramSnapshot({stateDir}={}) {
  const file = stateDir ? join(stateDir, ARAM_SNAPSHOT_FILE) : null;
  let data = {at: 0, rows: []};
  let index = new Map();
  const rebuild = () => {
    index = new Map();
    for (const row of data.rows) for (const key of indexKeys(row)) if (!index.has(key)) index.set(key, row);
  };
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved && Array.isArray(saved.rows)) {
        // 落盘的行一律带 _viewKind:'hero'；外部旧文件可能没带，读入时补齐，否则视图不会认。
        data = {at: Number(saved.at) || 0, rows: saved.rows.filter(row => row && Number.isFinite(Number(row.winRate))).map(row => ({...row, _viewKind: 'hero'}))};
        rebuild();
      }
    } catch {}
  }
  const save = (at = Date.now()) => {
    if (!file) return false;
    data.at = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    try {
      mkdirSync(stateDir, {recursive: true});
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify({at: data.at, rows: data.rows}));
      renameSync(tmp, file);
      return true;
    } catch { return false; }
  };
  const upsert = (row, key) => {
    if (!row || !Number.isFinite(Number(row.winRate))) return false;
    const next = {...row, _viewKind: 'hero', ...(typeof key === 'string' && key.trim() ? {key} : {})};
    const existing = data.rows.find(item => normalizeChampionKey(item.name) === normalizeChampionKey(next.name) && normalizeChampionKey(item.title) === normalizeChampionKey(next.title));
    const had = existing ?? (next.key ? data.rows.find(item => normalizeChampionKey(item.key) === normalizeChampionKey(next.key)) : null);
    if (had) Object.assign(had, next);
    else data.rows.push(next);
    rebuild();
    return true;
  };
  return {
    get at() { return data.at; },
    get size() { return data.rows.length; },
    fresh(now = Date.now()) { return data.rows.length > 0 && now - data.at < ARAM_SNAPSHOT_TTL_MS; },
    // 对局里查表：按 LCU 给的称号（也可能是本名/英文名）都能命中。
    lookup(name) {
      const row = index.get(normalizeChampionKey(name));
      return row ? {...row} : null;
    },
    upsert,
    remember(name, row) {
      if (!row) return false;
      // 对局中兜底查到的行只进内存，等下一次预取再落盘，避免整局每查一个英雄都写文件。
      return upsert({...row, _viewKind: 'hero'}, name);
    },
    save,
  };
}

// 按英雄名单预取整份快照。返回 {added, missed, failed}，调用方决定是否落盘。
// 429 时立刻停手：不能为了提前加载把玩家对局中的检索额度/退避状态打满。
export async function preloadAramSnapshot({snapshot, search, champions = [], onProgress, saveEvery = 40}) {
  let added = 0;
  const missed = [];
  let failure = null;
  let sinceSave = 0;
  for (const champion of champions) {
    let row = null;
    try {
      const result = await search({game: 'lol', query: champion, dataset: 'aram-ranking', limit: 1});
      row = (result?.results ?? []).map(item => item?.data).find(item => item && Number.isFinite(Number(item.winRate))) ?? null;
    } catch (error) {
      missed.push(champion);
      const status = Number(error?.status) || 0;
      // 429/未登录时立刻停手：继续打只会把额度/退避状态弄得更糟，等下一次空闲再试。
      if (status === 429 || status === 401 || status === 403) { failure = error; break; }
      continue;
    }
    if (!row) { missed.push(champion); continue; }
    if (snapshot.upsert(row, champion)) {
      added += 1;
      sinceSave += 1;
      // 中途落盘只保存已拿到的行，不刷新时间戳：应用若在预取途中退出，
      // 下次启动还会继续补齐，不会把「只拉了一半」当成完整快照。
      if (sinceSave >= saveEvery) { snapshot.save(snapshot.at); sinceSave = 0; }
    }
    onProgress?.({added, missed: missed.length, total: champions.length});
  }
  // 只有完整跑完才盖时间戳；中途失败则保留旧时间戳（半份数据可用，但下次还要补）。
  if (!failure && added > 0) snapshot.save();
  else if (added > 0) snapshot.save(snapshot.at);
  return {added, missed, failed: failure ? Number(failure.status) || 503 : 0, size: snapshot.size};
}
