// 每周查一次「网上在传什么说法」，只留像梗的短词，宁可这周没有，也不硬塞。
// 全部是纯函数；真正的联网搜索由上层注入（本机只走一个固定来源，不把玩家数据发出去）。
const BLOCK = /(政治|主席|总统|选举|两会|外交|军队|战争|死亡|去世|逝世|坠|爆炸|枪|袭击|地震|台风|洪水|疫情|病毒|癌|自杀|抑郁|强奸|色情|赌|毒|失业|裁员|彩礼|离婚|出轨|未成年|学生|校园|明星|恋情|官宣|法院|判刑|维权|涨价|股价|A股|币)/;
const NOISE = /(广告|点击|下载|微信|公众号|来源|版权|登录|注册|APP|app下载|搜索|百度|知乎|微博|小红书|抖音|哔哩|B站)/;

// 用 ISO 周：同一周内只查一次，失败也不重试到这个礼拜结束。
export function weekKey(at) {
  const date = new Date(Number(at));
  if (Number.isNaN(date.getTime())) return '';
  const point = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = point.getUTCDay() || 7;
  point.setUTCDate(point.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(point.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((point - yearStart) / 86400e3 + 1) / 7);
  return `${point.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const isStale = (record, at) => !record || record.week !== weekKey(at);

const clean = value => String(value ?? '')
  .replace(/[\s\u3000]+/g, '')
  .replace(/^[「“"『【]+|[」”"』】]+$/g, '')
  .replace(/[，。！？、；：,.;:!?~～…—-]+$/g, '')
  .trim();

export function acceptTerm(value) {
  const term = clean(value);
  if ([...term].length < 2 || [...term].length > 10) return null;
  if (!/[\u4e00-\u9fa5]/.test(term)) return null;      // 只要中文梗，纯英文/纯数字不要
  if (BLOCK.test(term) || NOISE.test(term)) return null;
  if (/^\d/.test(term)) return null;
  return term;
}

// 从搜索结果里捞出「像梗的短词」：引号里的、以及 xx体/xx文学/xx梗 这类后缀。
export function extractTerms(texts = []) {
  const found = new Map();
  const add = raw => {
    const term = acceptTerm(raw);
    if (term && !found.has(term)) found.set(term, true);
  };
  for (const text of Array.isArray(texts) ? texts : []) {
    const value = String(text ?? '');
    for (const match of value.matchAll(/[「“"『]([^」”"』]{2,12})[」”"』]/g)) add(match[1]);
    for (const match of value.matchAll(/([\u4e00-\u9fa5]{2,8}(?:体|文学|梗))/g)) {
      const base = match[1].replace(/(体|文学|梗)$/, '');
      add([...base].length >= 2 ? base : match[1]);
    }
  }
  return [...found.keys()].slice(0, 6);
}

// 存下来的一周记录；items 为空也要存，避免这一周反复去查。
export function summarize(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(term => acceptTerm(term)) : [];
  return { week: record?.week ?? '', items: items.slice(0, 5), at: Number(record?.at) || 0 };
}

// 热榜原样倒进来是新闻，不是梗：只留带「梗味」的短词，其余全丢。
// 宁可这周一条都没有，也不要把时政/灾难/球队八卦写进日记。
const MEME_MARK = /(梗|整活|离谱|破防|绷不住|名场面|节目效果|绝活|后劲|笑死|离谱|真香|上分|掉分|摆烂|躺赢|卷|肝|秀|典|孝|急|乐子|这波|那句|一辈子)/;
const NEWS_MARK = /(夺冠|冠军|决赛|赛后|赛后|教练|战队|选手|转会|赛季|发布会|通报|回应|宣布|签约|票房|销量|发布会|专访|盘点|测评|评测|攻略|教程|直播|开播|上映|预售)/;

export function rankCandidates(texts = [], { limit = 5 } = {}) {
  const scored = new Map();
  for (const text of Array.isArray(texts) ? texts : []) {
    const value = String(text ?? '');
    const candidates = [];
    for (const match of value.matchAll(/[「“"『]([^」”"』]{2,12})[」”"』]/g)) candidates.push(match[1]);
    for (const match of value.matchAll(/([\u4e00-\u9fa5]{2,8}(?:体|文学|梗))/g)) candidates.push(match[1].replace(/(体|文学|梗)$/, ''));
    const whole = acceptTerm(value);
    if (whole) candidates.push(whole);
    for (const raw of candidates) {
      const term = acceptTerm(raw);
      if (!term) continue;
      if (NEWS_MARK.test(value) && !MEME_MARK.test(value)) continue;   // 纯新闻里的词不要
      const score = (MEME_MARK.test(value) ? 2 : 0) + (MEME_MARK.test(term) ? 3 : 0) + (whole === term ? 1 : 0);
      if (score <= 0) continue;
      scored.set(term, Math.max(scored.get(term) ?? 0, score));
    }
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term).slice(0, limit);
}

// 给模型看的热榜词：比收进日记的标准宽一些（热榜词本来就更长），但照样挡掉时政/灾难/八卦。
export function promptTerm(value) {
  const term = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  const length = [...term].length;
  if (length < 2 || length > 24) return null;
  if (!/[\u4e00-\u9fa5]/.test(term)) return null;
  if (BLOCK.test(term) || NOISE.test(term)) return null;
  return term;
}

export function trendPrompt(texts = []) {
  const pool = (Array.isArray(texts) ? texts : []).map(promptTerm).filter(Boolean);
  const unique = [...new Set(pool)].slice(0, 30);
  if (!unique.length) return null;
  return '下面是这周的热榜词。挑出其中真正是「网络梗 / 流行说法」的（一个年轻玩家会认得、能自然说出口的），最多 3 个。'
    + '宁缺勿滥：新闻、赛事、球队、明星、时政、灾难一律不要；拿不准就不要挑。只输出 JSON 数组，例如 ["泰裤辣"]，一个都没有就输出 []。\n'
    + unique.join('、');
}
