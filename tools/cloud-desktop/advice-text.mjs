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

const SENTENCE_END = /[。！？!?.]/;

export function condenseAdvice(text, { maxChars = 68, maxSentences = 2 } = {}) {
  let value = stripSources(text);
  if (!value.trim()) return '';
  // Markdown 与常见排版噪音
  value = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s>*#\-\u2022]+/gm, '')
    .replace(/\r\n?/g, '\n');
  // 段落压成一句话之间：换行/多空白一律变单个空格
  value = value.replace(/\s+/g, ' ').trim();
  if (!value) return '';

  // 取前 maxSentences 句（以中文/西文句末标点切分，分号也算一句的边界）
  const sentences = [];
  let buffer = '';
  for (const ch of value) {
    buffer += ch;
    if (SENTENCE_END.test(ch)) {
      sentences.push(buffer.trim());
      buffer = '';
      if (sentences.length >= maxSentences) break;
    }
  }
  if (sentences.length < maxSentences && buffer.trim()) sentences.push(buffer.trim());
  // 中文句末不需要空格，西文句末需要，否则会粘成一个词
  let result = sentences.reduce((acc, s, i) => (i && /^[A-Za-z]/.test(s) ? acc + ' ' : acc) + s, '');

  if (result.length > maxChars) {
    const chars = Array.from(result);
    const clipped = chars.slice(0, maxChars).join('');
    let cut = Math.max(clipped.lastIndexOf('，'), clipped.lastIndexOf('；'), clipped.lastIndexOf('、'), clipped.lastIndexOf(','));
    let body = cut >= Math.floor(maxChars * 0.5) ? clipped.slice(0, cut) : clipped;
    body = body.replace(/[，、；,;.。！？!?\s]+$/, '');
    result = body + '。';
  }
  return result.trim();
}
