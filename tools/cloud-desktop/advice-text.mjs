// 播报正文的收口：模型经常忽略"最多两句"的指令，真实数据里平均 167 字、最长 533 字，
// 35/66 条带段落。这里做确定性收敛——去 Markdown、去段落、只留两句话、上限 68 字。
// 玩家不需要引用来源：实测模型会附上「来源Hexdata Patch 16.21，版本未经核实，仅供参考」
// 和 hexdata.com.cn 链接。这两类尾巴一律在渲染前剥掉。

export function stripSources(text) {
  let value = String(text ?? '');
  if (!value) return '';
  // 先去掉裸链接与"来源…"整段，再清理残留的方括号/标点
  value = value.replace(/https?:\/\/\S+/g, ' ');
  value = value.replace(/(?:来源|数据来源|参考来源)\s*[:：]?\s*[^\n。]*(?:。|$)/g, ' ');
  value = value.replace(/版本未经核实[^。]*。?/g, ' ');
  value = value.replace(/仅供参考[^。]*。?/g, ' ');
  // Markdown 星号/井号会原样出现在悬浮窗里（战况页实测出现 **离群之刺（阿卡丽）** 这种），
  // 这里一并去掉：加粗、斜体、行内代码、标题井号、列表符号。
  value = value.replace(/\*\*+|__+|`+|^#{1,6}\s+/gm, '');
  value = value.replace(/^\s*[-*+]\s+/gm, '· ');
  return value.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

// 人数清点/就位类播报没有决策价值（"我方5人已就位"），既占时间又打断节奏，直接不发。
const ROSTER_NOISE = /(?:我|敌|双)方[^。！？!?]{0,6}?\d*\s*人?\s*(?:已|都)?(?:就位|到齐|就绪|集结)|全员(?:已)?(?:就位|到齐|就绪)|十人到齐/;
export function noiseBroadcast(text) {
 const value = String(text ?? '');
 if (!value.trim()) return false;
 return ROSTER_NOISE.test(value);
}

const SENTENCE_END = /[。！？!?.]/;

// 玩家反馈（2026-11-19）：整段一次说完看着累，也不像真人说话。
// 现在收敛成 2~3 个小节，每节一行、一句口语短句（默认 20 字内），像边想边说。
const BEAT_END = /[。！？!?.；;]/;
function splitClauses(value) {
  const clauses = [];
  let buffer = '';
  for (const ch of value) {
    buffer += ch;
    if (BEAT_END.test(ch)) { if (buffer.trim()) clauses.push(buffer.trim()); buffer = ''; }
  }
  if (buffer.trim()) clauses.push(buffer.trim());
  return clauses;
}

function clipBeat(text, limit) {
  const chars = Array.from(text);
  if (chars.length <= limit) return text.trim();
  const clipped = chars.slice(0, limit).join('');
  const cut = Math.max(clipped.lastIndexOf('，'), clipped.lastIndexOf('、'), clipped.lastIndexOf(','), clipped.lastIndexOf(' '));
  const body = cut >= Math.floor(limit * 0.5) ? clipped.slice(0, cut) : clipped;
  return body.replace(/[，,、\s；;。．.]+$/, '');
}

export function condenseAdvice(text, { beatChars = 20, maxBeats = 3, maxChars = 72 } = {}) {
  let value = stripSources(text);
  if (!value.trim()) return '';
  value = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s>*#\-\u2022]+/gm, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';

  const clauses = splitClauses(value);
  const beats = [];
  for (const clause of clauses) {
    if (beats.length >= maxBeats) break;
    if (Array.from(clause).length > beatChars) {
      // 长句按标点切成小节；一刀切会丢信息，所以剩下的继续进下一节，直到用完 maxBeats。
      let rest = clause;
      while (rest && beats.length < maxBeats) {
        const head = clipBeat(rest, beatChars);
        if (!head) break;
        beats.push(head);
        const used = Array.from(head).length;
        rest = Array.from(rest).slice(used).join('').replace(/^[，,、\s；;。．.]+/, '');
      }
      continue;
    }
    beats.push(clause);
  }

  const kept = beats.filter(Boolean);
  while (kept.length && Array.from(kept.join('')).length > maxChars) kept.pop();
  return kept.join('\n').trim();
}
// 「同一句话反复播」是真实事故（2026-11-18 一个海克斯回合连播三条同义建议）：
// 2-gram Jaccard 只用来兜底「几乎逐字重复」，语义重复靠提示词里带上一句让它自己换说法。
export function adviceSimilarity(a, b) {
  const grams = value => {
    const text = String(value ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    const set = new Set();
    for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
    return set;
  };
  const left = grams(a), right = grams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}
