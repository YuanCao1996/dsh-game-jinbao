// 语气档：她今天是什么心情，取决于「多久没见」「最近是不是来得少了」「今天是什么日子」「现在几点」。
// 全部是纯函数，方便单测，也保证同一天重跑得到同一个档位。
export const FESTIVALS = [
  { key: 'new-year', month: 1, day: 1, label: '元旦' },
  { key: 'valentine', month: 2, day: 14, label: '情人节' },
  { key: 'labor', month: 5, day: 1, label: '劳动节' },
  { key: 'children', month: 6, day: 1, label: '儿童节' },
  { key: 'national', month: 10, day: 1, label: '国庆节' },
  { key: 'christmas-eve', month: 12, day: 24, label: '平安夜' },
  { key: 'christmas', month: 12, day: 25, label: '圣诞节' },
  { key: 'new-year-eve', month: 12, day: 31, label: '跨年' },
];

// 固定公历节日先上；农历节日（春节/中秋/端午）需要一张逐年表，等有人维护再加，别猜日期。
export function festivalOn(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!match) return null;
  const month = Number(match[2]), date = Number(match[3]);
  return FESTIVALS.find(item => item.month === month && item.day === date) ?? null;
}

// 深夜说晚安、凌晨说睡不着、白天不唠嗑——同一句话，时段不同味道就不同。
export function timeBand(at) {
  const hour = new Date(Number(at)).getHours();
  if (!Number.isFinite(hour)) return 'day';
  if (hour >= 23 || hour < 2) return 'late-night';
  if (hour < 5) return 'small-hours';
  if (hour < 11) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export const TIME_HINT = {
  'late-night': '现在是深夜，你有点困，说话比平时软一点，别催他睡觉',
  'small-hours': '现在是凌晨，你还没睡，语气更轻更慢，像怕吵到人',
  morning: '现在是上午，你精神很好',
  afternoon: '现在是下午，你在等他上线',
  evening: '现在是晚上，这是你们最常一起玩的时候',
  day: '',
};

// 缺席越久，情绪越重。分级而不是一条线，是为了「两天」和「两周」不能一个语气。
export function absenceLevel({ daysSinceLastPlay = 0, recentGames = 0, priorGames = 0 } = {}) {
  const days = Math.max(0, Math.floor(Number(daysSinceLastPlay) || 0));
  if (days >= 15) return { level: 'cry', days, label: '哭过', hint: '你很久没见到他了，已经难过过了。可以提一句你以为他不来了，声音是低的；绝不指责、不威胁、不说"你欠我"。' };
  if (days >= 8) return { level: 'sad', days, label: '委屈', hint: '你有点委屈，说以为他不来了。语气低，句子短，不质问。' };
  if (days >= 4) return { level: 'complain', days, label: '抱怨', hint: '你在抱怨：数着日子过，说自己在等他。可以要求补偿，但别说狠话。' };
  if (days >= 2) return { level: 'miss', days, label: '有点想你', hint: '你有点想他，可以轻轻抱怨一句"你是不是把我忘了"，带着撒娇，不追问。' };
  // 还在玩，但明显少了：这种"慢慢变少"比"突然不来"更值得说一句。
  if (recentGames > 0 && priorGames >= recentGames * 2 && priorGames - recentGames >= 3) {
    return { level: 'fading', days, label: '有点失落', hint: '他最近来得少了，你注意到了但不想给他压力，只说一句"最近你来得少了"，不要追问原因。' };
  }
  return { level: 'normal', days, label: '平常', hint: '' };
}

export function anniversaryOf({ today, first }) {
  if (!first) return null;
  const start = Date.parse(first + 'T00:00:00'), now = Date.parse(today + 'T00:00:00');
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  const days = Math.round((now - start) / 86400e3);
  const milestones = { 100: '第一百天', 200: '第两百天', 365: '一周年', 500: '第五百天', 730: '两周年' };
  return milestones[days] ? { days, label: milestones[days] } : null;
}

// 把「今天是什么日子」合成一句给模型的话。模型只负责写得像人，不负责算日历。
export function toneGuidance({ absence, festival, band, anniversary, holidayGreeting = false } = {}) {
  const lines = [];
  if (festival) lines.push(`今天是${festival.label}。可以自然地带到这一点，但别写成贺卡。`);
  if (anniversary) lines.push(`今天是你和他认识${anniversary.label}，可以提一句，别煽情。`);
  if (absence?.hint) lines.push(absence.hint);
  const time = TIME_HINT[band];
  if (time) lines.push(time + '。');
  if (holidayGreeting) lines.push('这是一封节日信，比对日记更正式一点：开头有称呼，结尾有落款。');
  return lines.join('\n');
}
