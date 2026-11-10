import {readFileSync as readLocalFile} from 'node:fs';
import {fileURLToPath as localFileUrl} from 'node:url';
// 称号 → Data Dragon alias；图标走公开 CDN，是否真的请求由页面上的「加载图标」开关决定。
const explorationAliases=(()=>{try{return JSON.parse(readLocalFile(localFileUrl(new URL('./exploration-aliases.json',import.meta.url)),'utf8'));}catch{return {};}})();
// 页面用本地地址：首次访问由本地服务下载并落盘，之后完全离线。
const championIcon=name=>{const alias=explorationAliases[name];return alias?'/exploration-icon/'+alias+'.jpg':null;};
// 本地版探索记录：不联网、不上传、没有排行榜。
//
// 只需要回答一件事：我自己探索过哪些英雄/模式。排行榜、跨设备同步、服务端防作弊
// 这些才需要服务器；本地记录放在状态目录里即可，也顺带避免了从腾讯资源服务器
// 拉图标暴露网络地址的问题。
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const CATEGORIES = {
  lol_pc: ['英雄', '模式'],
  wzry: ['英雄', '模式'],
  jinchanchan: ['阵容', '弈子', '羁绊', '模式'],
};

// 支持的赛季（与页面下拉一致）；未列出的赛季视为暂未开放。
const TFT_SEASONS = new Set(['S18', 'S17', 'S16', 'S11', 'S8', 'S4.5', 'S100024']);

const LOL_MODES = ['海克斯大乱斗', '极地大乱斗', '匹配', '排位'];


// 对局模式（日志里的 KIWI/ARAM/CLASSIC…）→ 图鉴里的模式名。
const MODE_LABELS = {KIWI: '海克斯大乱斗', ARAM: '极地大乱斗', CLASSIC: '匹配', RANKED_SOLO_5x5: '排位'};

export function modeLabel(mode) {
  const key = String(mode ?? '').toUpperCase();
  return MODE_LABELS[key] ?? '';
}
export function createLocalExploration({stateDir, catalog = {}, now = () => Date.now()}) {
  const root = join(stateDir, 'exploration');
  const file = join(root, 'records.json');
  let serial = Promise.resolve();
  const lock = fn => { const next = serial.then(fn); serial = next.catch(() => {}); return next; };
  const fail = (message, status = 400) => Object.assign(new Error(message), {status});

  async function load() {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'){ if(!Array.isArray(raw.matches)) raw.matches = []; return raw; }
    } catch {}
    return {version: 1, entries: {}, matches: []};
  }

  async function save(store) {
    await mkdir(root, {recursive: true});
    const temporary = file + '.' + Math.random().toString(16).slice(2) + '.tmp';
    await writeFile(temporary, JSON.stringify(store), {mode: 0o600});
    await rename(temporary, file);
  }

  function scope(game, season) {
    if (game === 'jinchanchan') {
      if (!TFT_SEASONS.has(season)) throw fail('该图鉴暂未开放');
      return season;
    }
    return '';
  }

  function names(game, season, category) {
    if (!CATEGORIES[game]) throw fail('该图鉴暂未开放');
    if (!CATEGORIES[game].includes(category)) throw fail('该图鉴暂未开放');
    if (category === '模式') return game === 'lol_pc' ? [...LOL_MODES] : [];
    return [...(catalog[game] ?? [])];
  }

  const key = (game, season, category, name) => [game, season, category, name].join('|');

  async function view(game, season, category) {
    const scoped = scope(game, season);
    const list = names(game, scoped, category);
    const store = await load();
    const selected = list.filter(name => store.entries[key(game, scoped, category, name)]);
    return {
      game, season: scoped, category,
      names: list,
      selected,
      aliases: {},
      icons: Object.fromEntries(list.map(name=>[name,championIcon(name)]).filter(([,url])=>!!url)),
      catalogComplete: list.length > 0,
      pending: 0,
      // 本地版没有排行榜，页面会据此隐藏参与/榜单区域
      participating: false,
      local: true,
      board: {entries: []},
      // 每个条目最近的对局回忆（只含本机记录），按时间倒序，最多 8 条。
      memories: Object.fromEntries(list.map(name => [name,
        store.matches.filter(row => row.category === category && row.entity === name)
          .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 8)
      ]).filter(([, rows]) => rows.length)),
    };
  }

  async function mark(game, season, category, entity, explored) {
    const scoped = scope(game, season);
    const list = names(game, scoped, category);
    if (!list.includes(entity)) throw fail('当前图鉴中没有该条目');
    return lock(async () => {
      const store = await load();
      const id = key(game, scoped, category, entity);
      if (explored) store.entries[id] = now();
      else delete store.entries[id];
      await save(store);
      return view(game, scoped, category);
    });
  }

  // 本地版没有云端参与/同步概念，这些动作保持幂等，页面不会报错。
  const participation = async () => ({participating: false, local: true});
  const sync = async () => ({pending: 0, local: true});
  const conflict = async () => { throw fail('当前没有可检查的冲突'); };
  const resolve = async () => ({local: true});


  // 从视图里尽量稳地抽出一局的关键信息：抽不到就留空，不编造。
  function matchMemory(view, champion, mode) {
    const text = value => String(value ?? '');
    const statLine = text(view?.stats) || text(view?.liveStats) || '';
    const kdaMatch = statLine.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
    const events = Array.isArray(view?.events) ? view.events : [];
    const texts = events.map(event => text(event?.text));
    const highlights = [];
    const multi = texts.find(line => /三杀|四杀|五杀|双杀/.test(line));
    if (multi) highlights.push((multi.match(/三杀|四杀|五杀|双杀/) ?? [''])[0]);
    const aces = texts.filter(line => line.includes('团灭')).length;
    if (aces) highlights.push('团灭 ×' + aces);
    const owned = Array.isArray(view?.augments) ? view.augments : [];
    const augments = owned.map(item => typeof item === 'string' ? item : text(item?.name)).filter(Boolean).slice(0, 6);
    const resultText = texts.find(line => /胜利|失败/.test(line)) ?? '';
    const win = /胜利/.test(resultText) ? true : /失败/.test(resultText) ? false : null;
    const startedAt = Number(view?.matchStartedAt) || null;
    const endedAt = Date.now();
    const durationSeconds = startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : (Number(view?.gameSeconds) || null);
    return {
      id: text(view?.match) || champion + '@' + endedAt,
      category: '英雄',
      entity: champion,
      mode,
      startedAt,
      endedAt,
      durationSeconds,
      kda: kdaMatch ? [Number(kdaMatch[1]), Number(kdaMatch[2]), Number(kdaMatch[3])] : null,
      win,
      augments,
      highlights,
    };
  }

  // 打完一局自动把「本局英雄 + 本局模式」记进探索记录：
  // 只在记录确实变化时落盘，避免每次轮询都写文件。
  async function recordMatch(view) {
    const game = view?.game;
    if (game !== 'lol') return {recorded: [], changed: false};
    const champion = String(view?.me?.champion ?? view?.selfChampion ?? '').trim();
    const mode = modeLabel(view?.mode);
    const recorded = [];
    let changed = false;
    const apply = async (category, entity) => {
      if (!entity) return;
      let list;
      try { list = names(game === 'lol' ? 'lol_pc' : game, '', category); } catch { return; }
      if (!list.includes(entity)) return;
      recorded.push(entity);
      await lock(async () => {
        const store = await load();
        const id = key('lol_pc', '', category, entity);
        if (store.entries[id]) return;
        store.entries[id] = now();
        await save(store);
        changed = true;
      });
    };
    await apply('英雄', champion);
    await apply('模式', mode);

    // 对局结束时补一条回忆：只在本机保存，用于图鉴里点开英雄看「一起打过什么」。
    const ended = view?.ended === true || String(view?.phase ?? '') === 'EndOfGame' || String(view?.title ?? '').includes('对局结束');
    if (ended && champion) {
      const memory = matchMemory(view, champion, mode);
      await lock(async () => {
        const store = await load();
        if (!Array.isArray(store.matches)) store.matches = [];
        if (store.matches.some(row => row.id === memory.id)) return;
        store.matches.push(memory);
        // 只保留最近 500 局，避免文件无限增长。
        if (store.matches.length > 500) store.matches = store.matches.slice(-500);
        await save(store);
        changed = true;
      });
      recorded.push('回忆');
    }
    return {recorded, changed};
  }

  return {view, mark, participation, sync, conflict, resolve, recordMatch};
}
