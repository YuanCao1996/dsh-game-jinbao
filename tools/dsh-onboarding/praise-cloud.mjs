// 多杀点评：云端生成一句话，失败时退回极短兜底。
// 要求后端对 topic=praise 走 enable_thinking:False + 小 max_tokens，以便 2 秒内返回。
import { buildPraisePrompt, shortPraise } from './multikill-praise.mjs';

/** 只取第一句，并裁到 limit 字（云端偶尔会多写）。 */
export function firstSentence(text, limit = 40) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const cut = raw.split(/(?<=[。！？!?])/)[0] ?? raw;
  const sentence = (cut || raw).trim();
  return sentence.length > limit ? sentence.slice(0, limit) : sentence;
}

/**
 * 请求云端生成多杀点评。
 * @returns {Promise<{text:string, source:'cloud'|'fallback'}>}
 * 绝不抛错：任何失败都退回短兜底（用户选择 B）。
 */
export async function requestPraise(agent, info, { timeoutMs = 2500 } = {}) {
  const fallback = shortPraise(info?.streak);
  if (!agent || typeof agent.ask !== 'function') return { text: fallback, source: 'fallback' };
  const question = buildPraisePrompt(info);
  let timer;
  try {
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const asked = agent.ask({
      game: info?.game ?? 'lol',
      match: info?.match,
      question,
      topic: 'praise',
      automatic: true,
    }).catch(() => null);
    const answer = await Promise.race([asked, timeout]);
    const text = firstSentence(answer?.text ?? answer?.answer ?? answer ?? '', 40);
    if (text) return { text, source: 'cloud' };
    return { text: fallback, source: 'fallback' };
  } catch {
    return { text: fallback, source: 'fallback' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}