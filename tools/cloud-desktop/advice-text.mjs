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
// 收敛规则：按句子切开，最多 3 句、每句单独一行；不在逗号/括号中间硬切——
// 碎成「下一件优先买」「：智慧末刃（2900」这种反而更难读。
export function condenseAdvice(text, { maxBeats = 3, maxChars = 90 } = {}) {
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

  const sentences = [];
  let buffer = '';
  for (const ch of value) {
    buffer += ch;
    if (SENTENCE_END.test(ch)) { if (buffer.trim()) sentences.push(buffer.trim()); buffer = ''; }
  }
  if (buffer.trim()) sentences.push(buffer.trim());

  const beats = sentences.slice(0, maxBeats);
  while (beats.length > 1 && Array.from(beats.join('')).length > maxChars) beats.pop();
  if (beats.length) beats[beats.length - 1] = beats.at(-1).replace(/[，,、；;\s]+$/, '') + (/[。！？!?.…]$/.test(beats.at(-1)) ? '' : '。');
  return beats.join('\n').trim();
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

// 任务接口对单条 message 的硬上限：2026-11-21 起放宽到 8000 字（服务端与客户端同步），预算留 200 字余量。
// 先丢掉末尾的可选提示（日记/上一句/情绪），再兜底截断——不能让整条建议因为一句提示作废。
export function fitPromptBudget(value, limit = 7800) {
  let text = String(value ?? '');
  if (text.length <= limit) return text;
  text = text
    .replace(/\n（你昨天在日记里写过：[^\n]*）/g, '')
    .replace(/\n（[^\n]{0,120}只在这一句里透一点情绪[^\n]*）/g, '')
    .replace(/\n刚才你已经说过：[^\n]*/g, '');
  return text.length > limit ? text.slice(0, limit) : text;
}
