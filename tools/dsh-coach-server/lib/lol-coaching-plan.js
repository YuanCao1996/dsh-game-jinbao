// Phase policy is independent of the Agent transport. Polls only wake the Agent
// for a milestone or a material change; dispatch rebuilds facts from live memory.
import {isCompletedItem} from '../../lol-companion/item-policy.mjs';
import {eventWindow} from './event-window.mjs';
import {MAYHEM_CORE,mayhemGuideText} from './aram-mayhem-guide.js';
const list = value => Array.isArray(value) ? value : [];
const names = value => list(value).map(x => typeof x === 'string' ? x : x?.name ?? x?.champion ?? x?.id).filter(Boolean);
const fingerprint = value => JSON.stringify(value);

export function stateCoachingTrigger(event, store) {
  if (!store) return null;
  const s = event.state ?? event;
  const time = Number(s.time);
  if (!Number.isFinite(time) || time < 0) return null;
  const level = Number(s.level);
  const ownCompleted=list(s.items).filter(isCompletedItem),enemyCompleted=list(s.enemyItems).filter(isCompletedItem);
  const old = store.coachingSnapshot;
  const material = fingerprint([names(ownCompleted).sort(), names(enemyCompleted).sort(), s.dead,
    s.teamfight?.phase, s.teamfight?.engage, s.championAugments]);
  const reset = !old || time < old.time;
  const reachedSix = level >= 6 && (reset || !old.reachedSix);
  const enemy = fingerprint([names(enemyCompleted).sort(), list(s.championAugments).filter(p => p.side === 'enemy')]);
  const ownItems = fingerprint(names(ownCompleted).sort());
  const died = !reset && s.dead === true && old.dead === false;
  const shopOpened = !reset && s.canShop === true && old.canShop !== true;
  const enemyChanged = !reset && enemy !== old.spokenEnemy;
  // 双方存活人数差跨过 ±2 是团战窗口开/关的唯一稳定信号。之前没有任何触发点会在
  // 人数变化时叫醒教练，所以“和队友怎么配合”只出现在开局与 6 级两次播报里。
  const side = Number.isInteger(s.alliesAlive) && Number.isInteger(s.enemiesAlive)
    ? s.alliesAlive - s.enemiesAlive : null;
  const priorSide = Number.isInteger(old?.sideDelta) ? old.sideDelta : null;
  const advantage = value => value !== null && value >= 2;
  const coordinationWindow = !reset && side !== null && priorSide !== null &&
    (advantage(side) !== advantage(priorSide) || advantage(-side) !== advantage(-priorSide));
  let reason = null;
  if (reset) reason = level >= 6 ? 'ultimate' : 'opening';
  else if (died) reason = 'death';
  else if (shopOpened) reason = 'purchase';
  else if (reachedSix) reason = 'ultimate';
  else if (coordinationWindow && time - (old.spokenCoordAt ?? -1e6) >= 45) reason = 'coordination';
  else if (enemyChanged && time - old.spokenAt >= 30) reason = 'enemyChange';
  else if (s.dead === true && ownItems !== old.spokenItems && time - old.spokenAt >= 15) reason = 'purchase';
  else if (material !== old.spokenMaterial && time - old.spokenAt >= 75) reason = 'situation';
  event.coachChanges = reason ? {died,shopOpened,enemyChanged,previousEnemy:old?.spokenEnemy ?? null,currentEnemy:enemy,
    ownItemsChanged:!reset && ownItems !== old.spokenItems} : null;
  store.coachingSnapshot = { time, reachedSix: reachedSix || (!reset && old.reachedSix),
    dead:typeof s.dead === 'boolean' ? s.dead : old?.dead,canShop:s.canShop,
    // 人数差在没有新数据时保留旧值，避免“数据缺失”被当成一次窗口变化。
    sideDelta: side !== null ? side : priorSide,
    spokenCoordAt: reason === 'coordination' ? time : old?.spokenCoordAt,
    spokenEnemy:reason ? enemy : old.spokenEnemy,spokenItems:reason ? ownItems : old.spokenItems,
    spokenMaterial: reason ? material : old.spokenMaterial,
    spokenAt: reason ? time : old.spokenAt };
  return reason;
}

const TASKS = {
  death: '刚刚阵亡，利用等待复活时间给两条调整：下次可购买时优先补哪件装备/组件，复活后下一波配合谁、避开什么威胁。结合当前金币、装备、全部已选强化和敌方变化；缺少死亡过程证据不要编造死因或责怪操作。没有商店权限事实时不要断言现在可以买。',
  purchase: '购买决策窗口：根据现有金币、已拥有装备、全部强化、敌方装备，推荐本次优先一件装备或组件，并说明针对谁、为什么。先查本模式价格和可购规则；不知道价格不要断言买得起。已买的不再重复推荐；canShop未确认则使用“下次可购买时”。',
  enemyChange: '对面装备或强化发生变化：指出新增/变化的具体装备或强化、属于哪位英雄，以及它影响自己的哪种打法。只选择确实会改变决策的威胁，给改目标、进场顺序或出装调整之一；变化不关键就静默。不把装备消失或缺失识别说成新增，不知道归属就明确未知。',
  selection: '从我当前英雄和实际可换的备选席中推荐首选与一个备选。结合本模式英雄胜率/强度和队友阵容缺口（前排、开团、清线、伤害类型），说明换或不换的原因；推荐两项本模式可用的召唤师技能及使用目的。不要推荐不在备选席的英雄；敌方未显示就不要猜对手。',
  loading: '用双方已知英雄点名说明这局的优势、最大威胁和取胜条件；英雄样本胜率不是本局获胜概率。给出适合自己英雄的出门装备及理由，再给6级前的消耗/清线/站位与配合方案。加载页不知道实际等级，不要宣称所有人都没大招。',
  opening: '给当前英雄的出门/下一购买窗口装备建议，并围绕双方阵容说明6级前先做什么、躲谁的哪个关键技能、配合哪位队友。自己未到6级不代表所有人没有大招；特殊英雄机制先核实。',
  ultimate: '刚进入6级及以后的打法阶段：点名自己大招的用途、配合哪位队友的控制、先后顺序和优先目标；也说明何时留大招反打。等级达到6不证明已学习大招或冷却结束，未知时用“有大招时/等队友控制命中”。不要猜当前技能CD。',
  augment: '只比较当前仍可选的海克斯，优先参考当前英雄适配排名，再结合全部已拥有强化、装备和对面阵容，明确“首选X，因为Y；备选Z”。单槽刷新后旧候选不再可选；解释具体收益或连招变化，不抄效果详情。没有候选就不要编造。',
  postAugment: '强化确认后的打法课，必须回答“这个强化怎么玩”：先说触发条件与连招顺序、什么时候主动用什么时候留着；再结合双方阵容点名敌方最大威胁与我方前排该跟谁；同时结合当前装备（点出关键成装或组件）和已选的全部海克斯之间的协同。效果文本以检索结果为准：没查到就明说效果文本未收录，但仍要按已知机制给出玩法判断，绝不能因为“数值未查到”就停止分析。按“怎么玩：…；配合谁：…；下一件成装：…”两到三句写完。',
  situation: '只针对本轮新变化给最重要的一条行动：装备成型、存活人数、血量、阵容威胁或推塔窗口。点名相关英雄/装备和行动条件；没有足够新信息就保持静默，不为播报而重复“注意站位、配合队友”。',
  coordination: '团战配合窗口刚打开或刚关闭（双方存活人数差发生变化）：只给一句配合方案，按“跟谁一起上→等他哪个技能命中→我放什么→先打谁”的顺序说，点名本局具体英雄。只用存活英雄和已知事实；队友大招状态未知就写“等他有大招时”，不猜冷却与技能是否可用，不写泛泛的注意配合、注意站位。',
  ace: '刚刚团灭对方：给出一个立刻能做的推进动作（推哪一路、拿哪个目标、还是先回城补给），并说明这段真空期还剩多久、手上血量或兵线是否支持；信息不足就说明要先确认什么。',
  inhib: '对方水晶被摧毁：说明超级兵带来的推线与视野变化，给出下一步压哪座塔或先清哪路线，避免越塔换命。',
  objective: '重要目标（小龙/大龙/先锋）刚被击杀或马上刷新：指出该利用还是该防守，给出具体动作和大致时间窗口。',
  turret: '防御塔刚被摧毁：判断转线、继续压塔还是回城补给，给出一个具体动作与理由，并点明下一个目标。',
  ended: '本局已结束，停止当前操作和购买建议；仅在有明确事件依据时给一条简短复盘。',
};

function hero(p) {
  if (typeof p === 'string') return { champion: p };
  if (!p) return null;
  return Object.fromEntries(['champion','name','tier','winRate','level','items','spells','dead','respawn','hpPct','gold','roles','canShop']
    .filter(key => p[key] != null).map(key => [key, p[key]]));
}

// 存活名单要跟着阶段任务一起进 prompt：配合建议必须点名具体英雄，
// 否则模型只能写“配合队友”这种没法执行的空话。
const aliveNames = (people, self) => list(people)
  .filter(person => person?.dead !== true && (!self || String(person?.champion ?? '') !== self))
  .map(person => String(person?.champion ?? '').trim()).filter(Boolean);
function coordinationBrief(current) {
  const mine = current?.me?.champion ? String(current.me.champion) : '';
  const ours = aliveNames(current?.allies, mine);
  if (mine && current?.me?.dead !== true) ours.unshift(mine);
  const theirs = aliveNames(current?.enemies);
  if (!ours.length && !theirs.length) return '';
  return '【本轮配合窗口】我方存活：' + ([...new Set(ours)].join('、') || '未知') +
    '；敌方存活：' + (theirs.join('、') || '未知') + '。点名其中具体英雄，不要泛称“队友”。';
}

export function buildLolCoachingPlan(events = [], current = null) {
  const latest = kind => [...events].reverse().find(e => e.kind === kind);
  const snapshot = latest('state');
  const s = snapshot?.state ?? snapshot ?? {};
  const roster = latest('loading_roster') ?? latest('load') ?? latest('game_start') ?? latest('champ_select') ?? {};
  const me = current?.me ?? roster.me ?? s;
  const phase = current?.phase ?? '';
  const offer = latest('augment_offer');
  const picked = latest('augment_picked') ?? events.flatMap(e => e.kind === 'chat_events' ? list(e.events) : [])
    .filter(e => e.kind === 'augment_picked_chat' && me.champion && e.champion === me.champion).at(-1);
  const active = Number(current?.gameSeconds ?? s.time ?? 0) > 0 || phase === 'InProgress';
  let stage = 'situation';
  if (current?.ended) stage = 'ended';
  else if (offer && (!current || list(current.offers).length)) stage = 'augment';
  else if ((picked && !['enemy','ally','other'].includes(picked.who) && (!picked.champion || picked.champion === me.champion)) || latest('augment_mutate')) stage = 'postAugment';
  else if (!active && (phase === 'ChampSelect' || latest('champ_select'))) stage = 'selection';
  else if (!active && (latest('load') || latest('loading_roster'))) stage = 'loading';
  else if (events.some(e => e.coachTrigger === 'ace')) stage = 'ace';
  else if (events.some(e => e.coachTrigger === 'inhib')) stage = 'inhib';
  else if (events.some(e => e.coachTrigger === 'objective')) stage = 'objective';
  else if (events.some(e => e.coachTrigger === 'turret')) stage = 'turret';
  else if (events.some(e => e.coachTrigger === 'death') && me.dead === true) stage = 'death';
  else if (events.some(e => e.coachTrigger === 'coordination')) stage = 'coordination';
  else if (events.some(e => e.coachTrigger === 'purchase')) stage = 'purchase';
  else if (events.some(e => e.coachTrigger === 'enemyChange')) stage = 'enemyChange';
  else if (events.some(e => e.coachTrigger === 'ultimate')) stage = 'ultimate';
  else if (latest('game_start') || events.some(e => e.coachTrigger === 'opening')) stage = Number(me.level) >= 6 ? 'ultimate' : 'opening';
  const facts = {
    stage, phase, gameSeconds: current?.gameSeconds ?? s.time ?? null,
    me: hero(me), allies: list(current?.allies ?? roster.allies).map(hero),
    enemies: list(current?.enemies ?? roster.enemies).map(hero),
    ownedAugments: current?.ownedAugments ?? s.teamfight?.pickedAugments ?? [],
    // 多杀硬字段：游戏事件里的 KillStreak 是权威值，提示词据此播报，禁止模型自己数或改口。
    multikill: (() => {
      const hit = [...events].reverse().find(e => e.kind === 'event' && String(e.name ?? e.EventName ?? '') === 'Multikill');
      if (!hit) return null;
      const streak = Number(hit.KillStreak ?? hit.killStreak ?? 0);
      if (!Number.isFinite(streak) || streak < 2) return null;
      const killer = String(hit.killer ?? hit.KillerName ?? '');
      const me2=String(current?.me?.champion ?? '').trim();
      const allies=list(current?.allies ?? roster.allies).map(p=>String(p?.champion ?? ''));
      const mine = !!killer && !!me2 && (killer.includes(me2) || allies.some(name => name && killer.includes(name)));
      return { streak, killer, mine, label: streak + '杀' };
    })(),
    // Round evidence retains confirmed vs inferred selection provenance.
    augmentRounds: list(current?.augmentRounds).slice(-6),
    // Same window as the overlay and the cloud Agent, so a turn never reasons about a
    // different slice of history than the one the user can see.
    recentEvents: eventWindow(current?.events).rows,
    recentAdvice: list(current?.broadcasts).slice(-3),
    triggeringObservations: events.slice(-8).map(e => ({kind:e.kind, reason:e.coachTrigger, changes:e.coachChanges,text:String(e.text ?? '').slice(0,1200)})),
    // The objective that opened this turn, so the advice can name it instead of guessing.
    keyEvent: latest('key_event')?.keyEvent ?? null,
    // Auto-picked augments (countdown default) are real picks but not user choices; the
    // advice must account for them and label the provenance.
    autoPickedAugments: list(current?.revealedAugments),
  };
  if (stage === 'selection') facts.bench = list(current?.bench ?? roster.bench).map(hero);
  if (stage === 'augment') facts.currentOptions = current?.offers ?? offer?.options ?? [];
  if (stage === 'postAugment') facts.selectionEvidence = picked ?? latest('augment_mutate');
  if (stage === 'coordination') {
    facts.alive = {
      allies: aliveNames(current?.allies, current?.me?.champion),
      enemies: aliveNames(current?.enemies),
      me: current?.me?.dead === true ? 'dead' : 'alive',
    };
  }
  // 海克斯大乱斗：核心决策顺序常驻，详细条目按阶段组装（只在确认 KIWI 模式时附加）。
  const mayhem = String(current?.mode ?? '').toUpperCase() === 'KIWI' || current?.gameMode === 'KIWI';
  const mayhemText = mayhem ? mayhemGuideText(stage) : '';
  const mayhemBrief = mayhemText
    ? '【海克斯大乱斗攻略要点】' + MAYHEM_CORE + '\n' + mayhemText
    : '';  return { stage, facts, prompt: [
    '【本轮阶段任务】' + TASKS[stage],
    stage === 'coordination' ? coordinationBrief(current) : '',
    '【本轮筛选事实 JSON】' + JSON.stringify(facts),
    mayhemBrief,
    '优先执行本轮阶段任务，不沿用历史阶段。输出最多两句、总计不超过60字、单段不换行；紧急局势仅一句。先结论再依据，每句对应本局英雄、强化、装备或事件。不复述面板，不输出泛泛口号，不显示玩家名。',
    '事实与资料分开：缺少决定结论的英雄技能、强化效果、装备或胜率资料时，使用现有DSH资料查询/联网工具，限定本局模式与版本；查不到就明确缺口，不编造数据。大招、金钱、装备和候选以最新事实为准。历史建议不是事实；不重复最近已播报且没有变化的建议。',
    '多杀数量只认 facts.multikill.streak（2=双杀，3=三杀，4=四杀，5=五杀及以上），不得自行数击杀或改写措辞；该字段为 null 时不要提多杀。',
    // 阵亡时玩家正在商店里，最有用的是一句「现在买哪件」。
    '阵亡回合必须点名一件具体装备（例如「先买负极大斗篷」），并给一句为什么；不要说「补个防装」「看情况出装」这类方向性说法。装备名用中文常用名。',
    // 三选一的排名已经由界面卡片呈现（带推荐高亮），再说一遍是重复噪音。
    '海克斯三选一时，候选与排名由界面卡片展示，回答里不要再逐条复述「No.N · 名称」；只给一句结论：选哪张，或建议刷新，必要时补半句理由。',
  ].filter(Boolean).join('\n') };
}

const canonical = value => fingerprint(names(value).sort());
function dependencies(current, stage) {
  if(current.game==='generic')return {windowTitle:current.me?.genericState?.windowTitle};
  const me = current.me ?? {};
  // A build component or another player's potion cannot invalidate how an
  // already-confirmed augment works. Revoke only facts this task depends on.
  const identity = {champion:me.champion,owned:canonical(current.ownedAugments)};
  if(stage==='postAugment')return identity;
  if(stage==='augment')return {...identity,offers:canonical(current.offers)};
  if(stage==='ultimate')return {...identity,levelBand:Number(me.level)>=6?'ultimate':'early'};
  // Objective stages stay valid while the window lasts: they depend on who is alive and
  // on the phase, not on every gold or component change.
  if(['ace','inhib','objective','turret','coordination'].includes(stage))
    return {champion:me.champion,phase:current.phase,
      allies:list(current.allies).filter(p=>p.dead!==true).map(p=>p.champion).sort().join(','),
      enemies:list(current.enemies).filter(p=>p.dead!==true).map(p=>p.champion).sort().join(',')};
  // An opening build order is a plan for the whole game: buying the first component or an
  // enemy finishing an item does not make it wrong. Only the champion (and, outside this
  // function, the match) defines which plan it is; the phase itself moves on immediately.
  if(stage==='opening')return {champion:me.champion};
  const common = {champion:me.champion,phase:current.phase,levelBand:Number(me.level)>=6?'ultimate':'early',items:canonical(list(me.items).filter(isCompletedItem)),owned:canonical(current.ownedAugments),dead:me.dead === true};
  if (stage === 'augment') return {...common,offers:canonical(current.offers)};
  if (stage === 'selection') return {champion:me.champion,phase:current.phase,bench:canonical(current.bench),allies:canonical(current.allies)};
  return {...common,enemy: fingerprint(list(current.enemies).map(p=>[p.champion,canonical(list(p.items).filter(isCompletedItem))])),
    enemyAugments:fingerprint(list(me.championAugments).filter(p=>p.side==='enemy')),canShop:me.canShop};
}

export function createAdviceValidity(stage, current, now = Date.now()) {
  if (!current) return null;
  // 开局规划讲的是整局的六件装备顺序，有效期按整局给。依赖项必须和 adviceIsValid
  // 里重算的那份一致，否则规划一生成就会被判成过期（opening 走默认依赖）。
  const ttl = stage === 'opening' ? 600000 : (['death','purchase','enemyChange','situation','ace','inhib','objective','turret','coordination'].includes(stage) ? 45000 : 90000);
  return {version:1,match:current.match,stage,createdAt:now,expiresAt:now+ttl,
    dependencies:dependencies(current,stage)};
}

export function adviceIsValid(validity, current, now = Date.now()) {
  if (!validity) return true; // Older clients and other games keep their playback contract.
  return validity.version === 1 && !current.ended && validity.match === current.match && now < validity.expiresAt &&
    fingerprint(validity.dependencies) === fingerprint(dependencies(current,validity.stage));
}

// A delayed recommendation must not tell the player to pick a rerolled option.
export function coachingStillCurrent(events, current) {
  if (!current) return true;
  if (events.some(e=>e.coachTrigger==='death') && current.me?.dead !== true) return false;
  const offer = [...events].reverse().find(e => e.kind === 'augment_offer');
  if (offer && fingerprint(names(offer.options).sort()) !== fingerprint(names(current.offers).sort())) return false;
  if (events.some(e => e.kind === 'champ_select') && current.phase && current.phase !== 'ChampSelect') return false;
  return !current.ended;
}
