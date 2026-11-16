// 把一天的事实压成一段很短的中文，交给模型写；再把回包校验、截断成可落盘的日记。
// 长度预算：prompt 必须留出角色设定（≤2000 字符上限）的位置，所以事实摘要只给要点。
import { TOPIC_LABEL } from './diary-day.mjs';

export const MOODS = ['得意', '平静', '心虚', '想念', '犯困'];
// 四个角色的「声音」：只改口吻，不改事实。没有的按金宝处理。
const ROLE_STYLE = {
  金宝: '口语、短句，会用语气词（啦、呀、哦、嘛），会自嘲，偶尔把话咽回去半句。',
  柳如风: '文一点、爱打比方，句子偏长，语气疏离但心软，少用语气词。',
  王霸天: '直、粗、短促，爱用「你」「老子」，几乎不用形容词，别文绉绉。',
  铁汁: '憨、话密，同一个词会重复，感叹号多一点，偶尔用错词也不改。',
};
const MAX_PROMPT = 1500;

const clock = seconds => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '';
  return `${Math.floor(value / 60)} 分钟`;
};

export const charCount = text => [...String(text ?? '')].length;

function quote(text) {
  const value = String(text ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
  return value ? `「${value}」` : '';
}

export function buildFactsBlock(facts = {}) {
  const lines = [];
  const matches = Array.isArray(facts.matches) ? facts.matches : [];
  if (matches.length) {
    const summary = matches.slice(0, 5).map(row => {
      const result = row.result === 'win' ? '赢了' : row.result === 'lose' ? '输了' : '没看清输赢';
      const kda = row.kda ? ` ${row.kda.k}/${row.kda.d}/${row.kda.a}` : '';
      return `${row.champion || '某个英雄'}（${result}${kda}${row.seconds ? '，' + clock(row.seconds) : ''}）`;
    }).join('、');
    lines.push(`打了 ${matches.length} 局：${summary}`);
    if (matches.some(row => row.adviceRevoked > 0)) lines.push('你中途改过口（说过的话又收回了）');
  }
  const chats = Array.isArray(facts.selfChats) ? facts.selfChats : [];
  if (chats.length) lines.push(`他在游戏里自己打的字：${chats.slice(0, 5).map(quote).filter(Boolean).join('')}`);
  if (Number(facts.appChats) > 0) lines.push(`他主动在应用里找过你 ${facts.appChats} 次`);
  if (Number(facts.aces) > 0) lines.push(`有 ${facts.aces} 次 ${(facts.aceLabels ?? []).join('/') || '团灭级'} 的高光`);
  if (Number(facts.gapDays) >= 3) lines.push(`你们隔了 ${facts.gapDays} 天才又见面`);
  if (Number(facts.streakDays) > 1) lines.push(`你连续第 ${facts.streakDays} 天和他一起玩`);
  if ((facts.firstTimeChampions ?? []).length) lines.push(`今天他第一次用 ${facts.firstTimeChampions[0]}`);
  const herLines = Array.isArray(facts.herLines) ? facts.herLines : [];
  if (herLines.length) lines.push(`你今天说过：${herLines.slice(-2).map(quote).filter(Boolean).join('')}`);
  return lines.join('\n');
}

export function buildPrompt({ day, facts, decision, role = '金宝', recent = [], strict = false, tone = '', weekly = false, letter = false, insight = '', trends = [] }) {
  const topic = decision?.topicLabel ?? TOPIC_LABEL[decision?.topic] ?? '今天';
  const min = Number(decision?.min) || 150, max = Number(decision?.max) || 280;
  const openings = (Array.isArray(recent) ? recent : []).map(item => String(item ?? '').slice(0, 30)).filter(Boolean).slice(0, 3);
  const opening = letter ? `【节日信】用第一人称给「${role}」写一封信，不是播报、不是战报。日期 ${day}。` : weekly ? `【一周回顾】用第一人称给「${role}」写一段这一周的回顾，不是播报、不是战报。日期 ${day}。` : `【今天的日记】用第一人称给「${role}」写一篇日记，不是播报、不是建议、不是战报。日期 ${day}。`;
  // 同一个角色每天写出来的东西也该有同一个「声音」：口癖、句子长短、会不会文绉绉。
  const style = ROLE_STYLE[role] ?? ROLE_STYLE['金宝'];
  const parts = [
    opening,
    `你的口吻：${style}`,
    buildFactsBlock(facts) || '今天没发生什么值得写的事。',
    `叙述重心：${topic}。`,
    `长度 ${min}—${Math.max(min + 20, max)} 字，最多 3 段；写完就停，不要总结。`,
    '只写一两件事，写深一点：落在一个具体瞬间、一件装备、一句他说过的话上。',
    decision?.formHint ? `写法：${decision.formHint}` : '',
    // 实测模型会写出「他打字『你先别——』」，而素材里根本没有这句话。宁可少一句也不能编。
    '他说过的话只能从上面「他在游戏里自己打的字」里取；素材没给就不要引用、不要编造对话。',
    '不要逐局列出英雄名，也不要把每一局都提一遍；不列数据，不评价他打得好不好。',
    '不要出现其他玩家昵称，指代只用「他」。不用「作为 AI／总之／综上」，不喊口号，不催他上线。',
    // 这些词是「像写作文」的最强信号：每篇都出现，读三篇就露馅。
    '别用这些词：愣住、暖光、手心全是汗、才发现、原来、眼眶、喉咙、心跳、屏幕的光、说不出的。',
    '允许不完整：可以省略主语、可以半句话、可以用括号补一句（比如「（算了）」）、可以写错再改。',
    '至少有一个具体到不像总结的细节：几点、第几局、哪件装备、哪次死法。',
    tone,
    trends.length ? '本周网上在传这些说法：' + trends.slice(0, 5).map(term => '「' + term + '」').join('') + '。只在你觉得完全贴合时用一处，绝不解释这个说法，也别硬塞；用不上就不用。' : '',
    insight ? `你可以提一句你的发现（用你自己的话说，别写成数据）：${insight}` : '',
    weekly ? '这一周的事合成一段，不要一天一段地报；只挑这一周最想说的一两处。' : '',
    letter ? '开头要有称呼（一句短的就够），结尾要有落款，别写落款日期以外的东西。' : '',
    openings.length ? `最近几篇是这么写的，换素材、换句式、换个结尾，别重样：${openings.join('／')}` : '',
  ];
  // 结尾的格式要求不能被长度截断掉——否则模型拿不到 JSON 契约，这一篇就废了。
  const tail = [
    'line 不是每天都写：只有真的想留一句才写，平时留空。',
    strict ? '上一次的回复不是合法 JSON，这次只准输出这个 JSON 对象。' : '',
    '只输出一个 JSON 对象，不要代码块以外的解释：',
    '{"title":"不超过12个字","body":"正文","mood":"得意|平静|心虚|想念|犯困","line":"明天想跟他说的一句话，不超过18字，可以留空"}',
  ].filter(Boolean).join('\n');
  const head = parts.filter(Boolean).join('\n');
  const room = Math.max(200, MAX_PROMPT - tail.length - 1);
  return (head.length > room ? head.slice(0, room) : head) + '\n' + tail;
}

export function trimBody(body, max) {
  const text = String(body ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (charCount(text) <= max) return text;
  const chars = [...text];
  const head = chars.slice(0, max);
  // 回退到最后一个完整句子，别把话截断在半句。
  for (let index = head.length - 1; index > head.length / 2; index--) {
    if ('。！？…'.includes(head[index])) return head.slice(0, index + 1).join('').trim();
  }
  return head.join('').trim();
}

function extractJson(reply) {
  const text = String(reply ?? '').trim();
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw Error('日记回复里没有 JSON');
  return JSON.parse(text.slice(start, end + 1));
}

export function parseDiaryReply(reply, { min = 150, max = 280 } = {}) {
  const value = extractJson(reply);
  const title = String(value.title ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 16);
  if (charCount(title) < 1) throw Error('日记缺少标题');
  const body = trimBody(value.body, Math.max(60, Math.round(max * 1.15)));
  const length = charCount(body);
  if (length < Math.max(40, Math.round(min * 0.45))) throw Error('日记太短：' + length);
  const mood = MOODS.includes(value.mood) ? value.mood : '平静';
  const line = String(value.line ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 20);
  return { title, body, paragraphs: body.split(/\n{2,}/).map(part => part.trim()).filter(Boolean), mood, line, chars: length };
}

// 交给调用方的 ask 只负责「问一句话、拿回一段文字」，模型路由由上层决定。
export async function writeDiary({ day, facts, decision, role = '金宝', recent = [], ask, now = Date.now, tone = '', weekly = false, letter = false, insight = '', trends = [] }) {
  if (typeof ask !== 'function') throw Error('缺少模型调用');
  const errors = [];
  for (const strict of [false, true]) {
    const prompt = buildPrompt({ day, facts, decision, role, recent, strict, tone, weekly, letter, insight, trends });
    let reply;
    try { reply = await ask(prompt); } catch (error) { errors.push(error?.message ?? String(error)); if (error?.status === 409 || error?.status === 401) break; continue; }
    try {
      const parsed = parseDiaryReply(reply, { min: decision?.min, max: decision?.max });
      return { version: 1, day, at: now(), role, ...parsed, topic: decision?.topic ?? 'champion', score: decision?.score ?? 0, kind: letter ? 'letter' : weekly ? 'weekly' : 'daily' };
    } catch (error) { errors.push(error.message); }
  }
  throw Object.assign(Error('日记没有写成：' + (errors[0] ?? '未知原因')), { code: 'diary_rejected' });
}

export function openingOf(entry) {
  const body = String(entry?.body ?? '').replace(/\s+/g, '');
  return [...body].slice(0, 10).join('') || String(entry?.title ?? '');
}
