// 日记里「今天算哪一天」「要不要写」「写多长」「写什么」都做成纯函数：
// 同一天重跑结果一致（不会一天写两篇），也能直接单测。
export const DAY_CUTOFF_HOURS = 4; // 次日 04:00 才换日：跨午夜的夜猫子局仍算前一天

const pad = value => String(value).padStart(2, '0');

export function dayKey(at, cutoffHours = DAY_CUTOFF_HOURS) {
  const shifted = new Date(Number(at) - cutoffHours * 3600e3);
  if (Number.isNaN(shifted.getTime())) throw Error('Invalid timestamp');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

export function dayStart(day, cutoffHours = DAY_CUTOFF_HOURS) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!match) throw Error('Invalid day');
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), cutoffHours, 0, 0, 0).getTime();
  if (Number.isNaN(at)) throw Error('Invalid day');
  return at;
}

export const dayRange = day => ({ from: dayStart(day), to: dayStart(day) + 86400e3 });

export function shiftDay(day, delta) {
  return dayKey(dayStart(day) + Number(delta) * 86400e3 + 3600e3, 0);
}

// FNV-1a：稳定、无依赖。同一个字符串永远得到同一个 0..1。
export function stableRoll(text) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(String(text), 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

const TOPIC_LABEL = {
  reunion: '久别重逢', ace: '一次团灭', chat: '他说的话', loss: '连胜断掉的局',
  champion: '一局里的某个瞬间', silence: '一晚上没说话',
};

// 分数只由「今天真的发生了多少值得说的事」决定，不用模型。
export function scoreDay(facts = {}) {
  const matches = Array.isArray(facts.matches) ? facts.matches : [];
  const selfChats = Array.isArray(facts.selfChats) ? facts.selfChats : [];
  const reasons = [];
  let score = 0;
  const add = (points, reason) => { if (points > 0) { score += points; reasons.push(reason); } };
  add(Math.min(6, matches.length), matches.length ? `${matches.length} 局` : '');
  add(Math.min(6, selfChats.length) * 2, selfChats.length ? `他打了 ${Math.min(6, selfChats.length)} 句` : '');
  add(Math.floor(Math.min(9, Number(facts.appChats) || 0) / 3), facts.appChats ? '主动找她聊过' : '');
  add(Math.min(4, (Number(facts.aces) || 0) * 2), facts.aces ? `${facts.aces} 次团灭级高光` : '');
  add(Number(facts.ignoredAdvice) > 0 ? 2 : 0, '建议被无视或被顶回来');
  add(Math.min(4, (Number(facts.firsts) || 0) * 2), facts.firsts ? '新收录的东西' : '');
  add(Number(facts.gapDays) >= 3 ? 2 : 0, '隔了几天才见');
  // 一局都没有、也没人说话：今天没有可写的东西。
  if (!matches.length && !selfChats.length && !(Number(facts.appChats) > 0)) return { score: 0, reasons: ['今天什么都没发生'] };
  return { score, reasons };
}

export function probabilityFor(score) {
  if (score < 3) return 0.12;
  if (score <= 6) return 0.45;
  if (score <= 12) return 0.7;
  return 0.85;
}

export function lengthFor(score) {
  if (score < 3) return { bucket: 'short', min: 80, max: 150 };
  if (score <= 6) return { bucket: 'medium', min: 150, max: 280 };
  return { bucket: 'long', min: 280, max: 450 };
}

// 主题由「今天最强的那个信号」决定，避免篇篇都从「今天打了几局」开头。
export function topicFor(facts = {}, matches = []) {
  if (Number(facts.gapDays) >= 3) return 'reunion';
  if (Number(facts.aces) > 0) return 'ace';
  if ((facts.selfChats ?? []).length >= 2) return 'chat';
  const lost = matches.filter(row => row.result === 'lose').length;
  if (lost >= 2 && lost === matches.length) return 'loss';
  if (matches.length) return 'champion';
  return 'silence';
}

export function decide({ facts = {}, salt = 'jinbao-diary', day } = {}) {
  const matches = Array.isArray(facts.matches) ? facts.matches : [];
  const date = day ?? facts.day;
  const { score, reasons } = scoreDay(facts);
  const probability = probabilityFor(score);
  const roll = stableRoll(`${date}:${salt}`);
  const { bucket, min, max } = lengthFor(score);
  const topic = topicFor(facts, matches);
  return {
    write: score > 0 && roll < probability,
    score, probability, roll, reasons, bucket, min, max, topic,
    topicLabel: TOPIC_LABEL[topic] ?? '今天',
    day: date,
  };
}

export { TOPIC_LABEL };
