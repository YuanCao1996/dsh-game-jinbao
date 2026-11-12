import {readFileSync as readLocalFile} from 'node:fs';
import {fileURLToPath as localFileUrl} from 'node:url';
// 称号 → Data Dragon alias；图标走公开 CDN，是否真的请求由页面上的「加载图标」开关决定。
const explorationAliases=(()=>{try{return JSON.parse(readLocalFile(localFileUrl(new URL('./exploration-aliases.json',import.meta.url)),'utf8'));}catch{return {};}})();
// 页面用本地地址：首次访问由本地服务下载并落盘，之后完全离线。
const championIcon=name=>{const alias=explorationAliases[name];return alias?'/exploration-icon/'+alias+'.jpg':null;};
// 英雄定位（roles）与开团/硬控标记：锐评要说「你是前排」得有依据。
const championRoster=(()=>{try{return JSON.parse(readLocalFile(localFileUrl(new URL('./lol-roster.json',import.meta.url)),'utf8'));}catch{return {};}})();
// 本地版探索记录：不联网、不上传、没有排行榜。
//
// 只需要回答一件事：我自己探索过哪些英雄/模式。排行榜、跨设备同步、服务端防作弊
// 这些才需要服务器；本地记录放在状态目录里即可，也顺带避免了从腾讯资源服务器
// 拉图标暴露网络地址的问题。
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {roastMatch} from './match-roast.mjs';

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
    await backfillFromLogs();
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
      // 上次一起打的时间（毫秒），卡片用来显示「上次一起 ?月?日」。
      lastPlayed: Object.fromEntries(list.map(name => [name,
        store.matches.filter(row => row.category === category && row.entity === name)
          .reduce((latest, row) => Math.max(latest, Number(row.endedAt) || 0), 0)
      ]).filter(([, at]) => at > 0)),
      // 每个条目最近的对局回忆（只含本机记录），按时间倒序，最多 8 条。
      memories: Object.fromEntries(list.map(name => [name,
        store.matches.filter(row => row.category === category && row.entity === name)
          .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 8)
      ]).filter(([, rows]) => rows.length)),
      // 全局时间线：所有已探索条目的对局，最近的排在前面（回忆画廊用）。
      timeline: store.matches
        .filter(row => row && row.category === category)
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 40)
        .map(row => ({ ...row, icon: championIcon(row.entity) ?? null })),
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
  function matchMemory(view, champion, mode, events = []) {
    const str = value => String(value ?? '').trim();
    const live = view?.liveStats && typeof view.liveStats === 'object' ? view.liveStats : null;
    // 权威来源优先级：view.me.k/d/a（客户端API）> liveStats.kda（OCR）> summary。
    const me = view?.me && typeof view.me === 'object' ? view.me : null;
    let kda = null;
    if (me && [me.k, me.d, me.a].every(v => Number.isFinite(Number(v)))) {
      kda = [Number(me.k), Number(me.d), Number(me.a)];
    } else {
      const kdaText = str(live?.kda) || (str(view?.summary).match(/(\d+\s*\/\s*\d+\s*\/\s*\d+)/) ?? [''])[0];
      const m = kdaText.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      if (m) kda = [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    const level = Number(me?.level) || Number(live?.level) || null;
    // 胜负：GameEnd 事件里的 Result 是权威值。
    const endEvent = events.filter(row => String(row?.name ?? row?.EventName ?? '') === 'GameEnd').at(-1);
    const result = str(endEvent?.Result);
    const win = result === 'Win' ? true : result === 'Lose' ? false : null;
    const clock = str(live?.clock) || str(view?.gameTime);
    const clockMatch = clock.match(/^(\d{1,3}):(\d{2})$/);
    const durationSeconds = clockMatch ? Number(clockMatch[1]) * 60 + Number(clockMatch[2]) : null;
    const startedAt = Number(view?.matchStartedAt) || null;
    const endedAt = Date.now();
    // 高光从事件文本抽：三杀/四杀/五杀/团灭；海克斯只记录本机确认过的（view.augments 是渲染字符串，不采）。
    const eventTexts = (Array.isArray(events) ? events : []).map(row => str(row?.text));
    const highlights = [];
    const multi = eventTexts.find(line => /五杀|四杀|三杀/.test(line));
    if (multi) highlights.push((multi.match(/五杀|四杀|三杀/) ?? [''])[0]);
    const aces = eventTexts.filter(line => line.includes('团灭')).length;
    if (aces) highlights.push('团灭 ×' + aces);
    return {
      id: str(view?.match) || champion + '@' + endedAt,
      category: '英雄',
      entity: champion,
      mode,
      startedAt,
      endedAt,
      durationSeconds,
      level,
      kda,
      win,
      augments: [],
      highlights,
      // 视图里才有队友/对手阵容；日志里没有这份名单。
      allies: Array.isArray(view?.allies) ? view.allies.map(p => String(p?.champion ?? p ?? '')).filter(Boolean).slice(0, 5) : [],
      enemies: Array.isArray(view?.enemies) ? view.enemies.map(p => String(p?.champion ?? p ?? '')).filter(Boolean).slice(0, 5) : [],
      items: Array.isArray(view?.me?.items) ? view.me.items.filter(Boolean).slice(0, 6) : [],
    };
  }

  // 从一局的对局日志里读终局事实。日志是权威来源：视图里没有 Result、没有补刀、
  // 没有推塔与多杀明细，也没有已确认的海克斯名。
  async function readMatchLog(matchId) {
    const fileName = String(matchId ?? '').split('#')[0];
    if (!fileName) return null;
    let raw;
    try { raw = await readFile(join(root, '..', 'logs', fileName), 'utf8'); } catch { return null; }

    let me = null, win = null, duration = null;
    let teamKills = null, enemyKills = null;
    let turrets = 0, inhibs = 0, firstBlood = false;
    let aceFor = 0, aceAgainst = 0;
    let multikillMax = 0, multikillCount = 0;
    const augments = [];
    const highlights = [];
    let myTeam = null;              // 'CHAOS' / 'ORDER'，从击杀归属反推
    const myName = () => String(me?.riotId ?? '').split('#')[0];
    const myChampion = () => String(me?.champion ?? '').trim();
    // 击杀/推塔事件里能带出「我在哪一边」：目标名里含 TOrder / TChaos。
    const teamFromVictim = (target) => {
      const text = String(target ?? '');
      if (text.includes('TOrder')) return 'CHAOS';
      if (text.includes('TChaos')) return 'ORDER';
      return null;
    };
    const involved = (event, names) => {
      const mine = myName();
      if (!mine) return false;
      if (String(event.killer ?? event.KillerName ?? '') === mine) return true;
      return Array.isArray(event[names ?? 'Assisters']) && event[names ?? 'Assisters'].includes(mine);
    };

    for (const line of raw.split('\n')) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.kind === 'phase' && event.phase === 'PreEndOfGame' && me) break;
      if (event.kind === 'state') {
        const candidate = event.state?.me ?? event.me;
        if (candidate) me = candidate;
        const st = event.state ?? event;
        const tk = Number(st?.teamKills), ek = Number(st?.enemyKills);
        if (Number.isFinite(tk)) teamKills = tk;
        if (Number.isFinite(ek)) enemyKills = ek;
      }
      if (event.kind === 'augment_picked') {
        const name = String(event.augment ?? event.name ?? '').trim();
        const mine = event.who === undefined || event.who === 'self';
        if (name && mine && !augments.includes(name)) augments.push(name);
      }
      // 视觉复核给出的归属：只有指向自己英雄的才算本局已选（别人的强化不算）。
      if (event.kind === 'augment_mutate') {
        const name = String(event.augment ?? '').trim();
        const owner = String(event.champion ?? '').trim();
        if (name && owner && owner === myChampion() && !augments.includes(name)) augments.push(name);
      }
      if (event.kind !== 'event') continue;
      const name = String(event.name ?? event.EventName ?? '');
      const mine = !!myName() && String(event.killer ?? event.KillerName ?? '') === myName();
      if (name === 'GameEnd') {
        const result = String(event.Result ?? '');
        if (result === 'Win') win = true; else if (result === 'Lose') win = false;
        if (Number.isFinite(Number(event.EventTime))) duration = Math.round(Number(event.EventTime));
      }
      if (name === 'FirstBlood') {
        if (String(event.Recipient ?? '') === myName()) firstBlood = true;
      }
      if (name === 'TurretKilled' && involved(event)) {
        turrets += 1;
        myTeam = myTeam ?? teamFromVictim(event.turret ?? event.TurretKilled);
      }
      if (name === 'InhibKilled' && involved(event)) {
        inhibs += 1;
        myTeam = myTeam ?? teamFromVictim(event.InhibKilled ?? event.turret);
      }
      if (name === 'Ace') {
        const acingTeam = String(event.AcingTeam ?? '');
        // 没法判断阵营时退回到「击杀者是不是我」。
        const ours = myTeam ? acingTeam === myTeam : String(event.Acer ?? '') === myName();
        if (ours) aceFor += 1; else aceAgainst += 1;
      }
      if (/Multikill/.test(name)) {
        const streak = Number(event.KillStreak ?? 0);
        const killer = String(event.KillerName ?? event.killer ?? '');
        if (killer && killer === myName()) {
          multikillCount += 1;
          if (streak > multikillMax) multikillMax = streak;
          const label = streak >= 5 ? '五杀' : streak === 4 ? '四杀' : streak === 3 ? '三杀' : null;
          if (label && !highlights.includes(label)) highlights.push(label);
        }
      }
    }

    const facts = {
      kda: null, level: null, win, durationSeconds: duration || null,
      highlights, augments, turrets, inhibs, firstBlood,
      aceFor, aceAgainst, multikillMax, multikillCount,
      teamKills, enemyKills,
    };
    if (me) {
      const k = Number(me.k), d = Number(me.d), a = Number(me.a);
      if ([k, d, a].every(Number.isFinite)) facts.kda = [k, d, a];
      if (Number.isFinite(Number(me.level))) facts.level = Number(me.level);
      if (Number.isFinite(Number(me.cs))) facts.cs = Number(me.cs);
      if (Array.isArray(me.items)) facts.items = me.items.filter(Boolean).slice(0, 7);
      if (Array.isArray(me.spells)) facts.spells = me.spells.map(String).filter(Boolean).slice(0, 2);
      if (me.championAlias) facts.championAlias = String(me.championAlias);
      if (me.championTitle) facts.championTitle = String(me.championTitle);
      facts.riotId = String(me.riotId ?? '') || null;
    }
    return facts;
  }

  // 日志事实合并进回忆：日志优先，视图里有而日志没有的（队友/对手）保留。
  function mergeLogFacts(memory, facts) {
    if (!facts) return memory;
    if (facts.kda) memory.kda = facts.kda;
    if (facts.level) memory.level = facts.level;
    if (facts.win !== null) memory.win = facts.win;
    if (facts.durationSeconds) memory.durationSeconds = facts.durationSeconds;
    if (Array.isArray(facts.highlights) && facts.highlights.length) memory.highlights = facts.highlights;
    if (Array.isArray(facts.augments) && facts.augments.length) memory.augments = facts.augments;
    if (Array.isArray(facts.items) && facts.items.length) {
      // 只保留成装名（消耗品如魄罗佳肴不进回忆）。
      memory.items = facts.items.filter(item => item && item.completed === true).map(item => String(item.name ?? '')).filter(Boolean).slice(0, 6);
    }
    if (Array.isArray(facts.spells) && facts.spells.length) memory.spells = facts.spells;
    if (facts.championAlias) memory.championAlias = facts.championAlias;
    for (const key of ['cs', 'turrets', 'inhibs', 'aceFor', 'aceAgainst', 'multikillMax', 'multikillCount', 'teamKills', 'enemyKills']) {
      if (Number.isFinite(Number(facts[key]))) memory[key] = Number(facts[key]);
    }
    // 显式写布尔：缺字段会让页面与成就统计都读不到「没拿一血」这个事实。
    memory.firstBlood = facts.firstBlood === true;
    if (facts.riotId) memory.riotId = facts.riotId;
    return memory;
  }

  // 给一条回忆补上派生统计与锐评。
  function decorate(memory, others = []) {
    const kda = Array.isArray(memory.kda) ? memory.kda.map(Number) : null;
    const minutes = Number(memory.durationSeconds) > 0 ? Number(memory.durationSeconds) / 60 : null;
    if (kda && Number.isFinite(minutes) && minutes > 0) {
      memory.kdaPerMinute = Number(((kda[0] + kda[2]) / minutes).toFixed(2));
    }
    if (kda && Number.isFinite(Number(memory.teamKills)) && Number(memory.teamKills) > 0) {
      memory.involvement = Number((((kda[0] + kda[2]) / Number(memory.teamKills)) * 100).toFixed(1));
    }
    if (Number.isFinite(Number(memory.cs)) && Number.isFinite(minutes) && minutes > 0) {
      memory.csPerMinute = Number((Number(memory.cs) / minutes).toFixed(1));
    }
    // 英雄定位：锐评里「你是前排/开团点」需要依据。
    const profile = championRoster[memory.entity] ?? null;
    if (profile) {
      memory.roles = Array.isArray(profile.roles) ? profile.roles : [];
      memory.engage = profile.engage === true;
      memory.hardCC = profile.cc === true;
    }
    memory.completedItems = Array.isArray(memory.items) ? memory.items.length : 0;

    // 个人最佳：只跟同英雄的历史比，不跨英雄、不跟别人比。
    const same = others.filter(row => row && row.entity === memory.entity && Array.isArray(row.kda));
    const bestKills = Math.max(0, ...same.map(row => Number(row.kda[0]) || 0));
    const bestInvolvement = Math.max(0, ...same.map(row => Number(row.involvement) || 0));
    const bestMultikill = Math.max(0, ...same.map(row => Number(row.multikillMax) || 0));
    // 只有「已经打过这个英雄」时才算破纪录，否则第一次打就成了纪录，说服力为零。
    const hasHistory = same.length >= 1;
    memory.personalBest = {
      bestKills: hasHistory && kda && Number(kda[0]) > bestKills ? Number(kda[0]) : null,
      bestInvolvement: hasHistory && memory.involvement != null && memory.involvement > bestInvolvement ? memory.involvement : null,
      longestMultikill: hasHistory && Number(memory.multikillMax) > bestMultikill && bestMultikill > 0 ? Number(memory.multikillMax) : null,
      firstTime: hasHistory ? null : true,
    };
    memory.roast = roastMatch(memory, { personalBest: memory.personalBest, profile });
    return memory;
  }

  // 旧版抽取失败时留下的回忆只有时长、没有 KDA/胜负。对局日志里其实有终局数据，
  // 进程启动后跑一次回填，把这类空记录补全（日志不存在就跳过，不编造）。
  let backfillAt = 0;
  async function backfillFromLogs() {
    // 节流：新写入的回忆也可能缺字段，不能只跑一次。
    if (Date.now() - backfillAt < 60000) return;
    backfillAt = Date.now();
    const store = await load();
    if (!Array.isArray(store.matches) || !store.matches.length) return;
    const needs = store.matches.filter(row => row && (
      !row.kda || row.win === null || row.win === undefined ||
      !Array.isArray(row.augments) || row.augments.length === 0 ||
      !Number.isFinite(Number(row.cs)) || !row.roast
    ));
    if (!needs.length) return;
    let changed = false;
    for (const row of needs) {
      const facts = await readMatchLog(row.id);
      if (!facts) continue;
      const before = JSON.stringify([row.augments, row.cs, row.turrets, row.multikillMax]);
      mergeLogFacts(row, facts);
      decorate(row, store.matches.filter(other => other !== row));
      const after = JSON.stringify([row.augments, row.cs, row.turrets, row.multikillMax]);
      if (before !== after || row.kda) changed = true;
    }
    if (changed) await save(store);
  }
  // 打完一局自动把「本局英雄 + 本局模式」记进探索记录：
  // 只在记录确实变化时落盘，避免每次轮询都写文件。
  async function recordMatch(view, events = []) {
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
      const memory = matchMemory(view, champion, mode, events);
      // 日志里的终局事实比视图可靠（视图没有 Result，KDA 也可能只是某一帧）。
      const fromLog = await readMatchLog(memory.id);
      if (fromLog) mergeLogFacts(memory, fromLog);
      await lock(async () => {
        const store = await load();
        if (!Array.isArray(store.matches)) store.matches = [];
        // 清掉旧版抽取失败写进来的空回忆（KDA、时长、等级全空）。
        store.matches = store.matches.filter(row => row && (row.kda || row.durationSeconds || row.level));
        const existing = store.matches.find(row => row.id === memory.id);
        if (existing) {
          // 同一局可能先用旧版/不完整数据记过：新记录更全时就地覆盖，
          // 而不是直接丢弃（实测一局 KDA 被早先的空记录挡住）。
          const richer = (row, other) =>
            (row.kda ? 1 : 0) + (row.level ? 1 : 0) + (row.durationSeconds ? 1 : 0)
            > (other.kda ? 1 : 0) + (other.level ? 1 : 0) + (other.durationSeconds ? 1 : 0);
          if (richer(memory, existing)) {
            Object.assign(existing, memory);
            decorate(existing, store.matches.filter(row => row !== existing));
          }
          await save(store);
          return;
        }
        // 统计与锐评在落盘前算好，之后看回忆不用再重算。
        decorate(memory, store.matches);
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
