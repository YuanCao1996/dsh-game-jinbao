// 聊天 OCR 的校验与纠错。
//
// OCR 出来的聊天行常见三类错误：
//   1. 时间前缀坏了（"05:2B"、"O5:27"）——整行时间不可信；
//   2. 名字错字（"OB大魔玉" / "皮城执法宫"）——可以按本局名单做最近邻纠正；
//   3. 空行/乱码（只剩符号）——直接丢掉，别喂给教练。
//
// 原则：能确定的就纠正，不能确定的就丢。宁可少一条，也不要给教练假情报。

/** 编辑距离（只做小字符串，够用）。 */
export function editDistance(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (x === y) return 0;
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[y.length];
}

/** 把疑似 OCR 错字的名字吸附到候选名单；吸附不上返回 null。 */
export function snapName(value, pool = [], maxDistance = 2) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (pool.includes(raw)) return raw;
  let best = null, bestScore = Infinity;
  for (const candidate of pool) {
    if (!candidate) continue;
    const distance = editDistance(raw, candidate);
    if (distance < bestScore) { bestScore = distance; best = candidate; }
  }
  // 名字越长容忍度越低：两个字的名字错一个字就不该硬认。
  // 长名字错两个字仍然认得出（「奥瑞利安·索尔」「凡性的提醒」）；短名字只容一个。
  const limit = Math.min(maxDistance, raw.length >= 5 ? 2 : 1);
  return best && bestScore <= limit ? best : null;
}

/** "05:27" → 327 秒；格式不对返回 null。 */
export function clockSeconds(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value ?? ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 一行里"像乱码"的比例：问号、方框、替换符占多数就不可信。 */
export function garbageRatio(text) {
  const value = String(text ?? '');
  if (!value) return 1;
  const bad = (value.match(/[?\uFFFD\u25A1\u25A0]{1}|口口/g) ?? []).length;
  return bad / value.length;
}

/**
 * 校验并纠正一条解析结果。
 * @returns 纠正后的消息，或 null（不可信，丢弃）
 */
/**
 * 在整行文本里把"像某个名字"的片段替换成规范名。
 *
 * 为什么要在解析前做：OCR 把「皮城执法官」认成「皮城执法宫」时，解析器连"这是谁"都认不出，
 * 这一行会直接变成 other 被丢掉；只有先把名字修对，后面的结构化解析才有机会命中。
 *
 * 只对候选名单做窗口比对，不碰句子结构；替换后长度不变（名字等长），不会破坏时间前缀。
 */
export function snapInText(text, pool = [], maxDistance = 2) {
  const value = String(text ?? '');
  if (!value || !pool.length) return value;
  const chars = Array.from(value);
  let out = value;
  for (const name of pool) {
    const target = Array.from(String(name));
    const length = target.length;
    if (length < 2 || !name) continue;
    if (out.includes(name)) continue;                 // 已经对上了就别动
    for (let start = 0; start + length <= chars.length; start += 1) {
      const window = chars.slice(start, start + length).join('');
      if (!window.trim()) continue;
      if (editDistance(window, name) <= Math.min(maxDistance, length >= 5 ? 2 : 1)) {
        // 按字符位置替换，保证长度不变
        for (let i = 0; i < length; i += 1) chars[start + i] = target[i];
        out = chars.join('');
        break;
      }
    }
  }
  return out;
}

export function correctMessage(message, { clock = null, players = [], champions = [], augments = [], items = [], maxDistance = 2 } = {}) {
  if (!message || typeof message !== 'object') return null;
  const time = String(message.time ?? '');
  if (time) {
    const seconds = clockSeconds(time);
    if (seconds === null) return null;                       // 时间前缀坏了
    if (Number.isFinite(clock) && seconds > Number(clock) + 10) return null; // 比当前对局时钟还新
  }
  const rendered = String(message.display ?? message.text ?? '');
  if (rendered && garbageRatio(rendered) > 0.25) return null;

  const namePool = [...new Set([...players, ...champions].filter(Boolean))];
  const fixName = (value) => {
    if (!value) return value ?? null;
    return snapName(value, namePool, maxDistance);
  };

  const next = { ...message };
  if (next.kind === 'kill') {
    next.killer = fixName(next.killer);
    next.victim = fixName(next.victim);
    // 击杀公告的主语必须认得出是谁，否则这条没有价值。
    if (!next.killer) return null;
    if (next.victim === null) next.victim = null;
  }
  if (next.kind === 'ping') {
    next.champion = fixName(next.champion);
    if (!next.champion) return null;
  }
  if (next.kind === 'team_chat') {
    // 看不出是谁说的、也不是「名字：内容」句式，多半是 HUD/加载页文字，直接丢。
    const shape = String(next.content ?? next.text ?? '');
    if (!next.speaker && !/[：:]/.test(shape)) return null;
    // 打字内容不改（改了就篡改玩家原话），但说话人尽量纠正。
    if (next.speaker) next.speaker = snapName(next.speaker, players, maxDistance) ?? next.speaker;
    const content = String(next.content ?? '').trim();
    if (!content || garbageRatio(content) > 0.3) return null;
    next.content = content;
  }
  // 装备名：购买公告里的物品名同样容易被 OCR 认错（「凡性的提酲」）。
  if (next.kind === 'purchase' && next.item) {
    next.item = snapName(next.item, items, maxDistance) ?? null;
    if (!next.item) return null;                 // 认不出是哪件装备，这条没有价值
  }
  // 英雄名统一再吸附一次（击杀/终结行里的括号内英雄名）。
  for (const key of ['champion', 'speakerChampion']) {
    if (next[key]) next[key] = snapName(next[key], champions, maxDistance) ?? next[key];
  }
  if (Array.isArray(next.champions)) {
    next.champions = next.champions.map((name) => snapName(name, champions, maxDistance) ?? name);
  }
  if (Array.isArray(next.augments)) {
    next.augments = next.augments.map((name) => snapName(name, augments, 1) ?? name);
    if (next.augment) next.augment = snapName(next.augment, augments, 1) ?? next.augment;
  }
  return next;
}
