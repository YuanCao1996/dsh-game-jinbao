// 播报出口的装备名校验：模型偶尔会把装备名改写成不存在的名字
// （实测「狂战士胫甲」被写成「奥拉夫胫甲」）。这里只在本局已知装备名里做
// 唯一形近纠正；宁可不改，也不猜一个不存在的装备，更不碰「下一件装备」这类普通词。
import {readFileSync} from 'node:fs';

const CATALOG = JSON.parse(readFileSync(new URL('../lol-companion/item-names.json', import.meta.url), 'utf8'));
const normalize = (value) => String(value ?? '')
  .replace(/\s+/g, '')
  .replace(/[：:·•・.。,，;；、!！?？—－-]/g, '');
const isHan = (text) => /^[\u4e00-\u9fa5]+$/.test(text);

function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    let rowMin = next[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, next[j]);
    }
    if (rowMin > max) return max + 1;
    prev = next;
  }
  return prev[b.length];
}

function indexNames(names) {
  const known = new Map();
  const bySuffix = new Map();
  for (const name of names) {
    const key = normalize(name);
    if (!key || known.has(key)) continue;
    known.set(key, String(name));
    if (key.length < 3) continue;
    const suffix = key.slice(-2);
    if (!bySuffix.has(suffix)) bySuffix.set(suffix, []);
    bySuffix.get(suffix).push({key, name: String(name)});
  }
  return {known, bySuffix};
}

export function createItemNameVerifier(names = CATALOG) {
  const global = indexNames(names);
  function fix(text, contextNames = []) {
    if (typeof text !== 'string' || !/[\u4e00-\u9fa5]/.test(text)) return text;
    // 仅在本局真正出现过的装备里纠错；本局没出现过的名字不做额外猜测。
    const context = indexNames(contextNames);
    if (!context.known.size) return text;
    const chars = [...text];
    const replacements = [];
    for (let i = 0; i < chars.length - 1; i += 1) {
      const suffix = chars[i] + chars[i + 1];
      if (!context.bySuffix.has(suffix)) continue;
      // 已经出现完整合法装备名时直接跳过，绝不裁掉「出了/补了」等上下文动词。
      let exact = false;
      for (let length = Math.min(6, i + 2); length >= 2; length -= 1) {
        const candidate = chars.slice(i + 2 - length, i + 2).join('');
        if (!isHan(candidate)) continue;
        if (global.known.has(normalize(candidate))) { exact = true; break; }
      }
      if (exact) continue;
      let best = null;
      for (let length = Math.min(6, i + 2); length >= 4; length -= 1) {
        const candidate = chars.slice(i + 2 - length, i + 2).join('');
        if (!isHan(candidate)) continue;
        const key = normalize(candidate);
        if (key.length !== length) continue;
        let match = null;
        let ambiguous = false;
        for (const target of context.bySuffix.get(suffix) ?? []) {
          const distance = levenshtein(key, target.key, 3);
          if (distance < 1 || distance > 3) continue;
          if (match && target.name !== match.name) { ambiguous = true; break; }
          match = target;
        }
        if (ambiguous || !match) continue;
        best = {start: i + 2 - length, end: i + 1, name: match.name};
        break;
      }
      if (best) replacements.push(best);
    }
    if (!replacements.length) return text;
    let output = '';
    let cursor = 0;
    for (const replacement of replacements) {
      if (replacement.start < cursor) continue;
      output += chars.slice(cursor, replacement.start).join('') + replacement.name;
      cursor = replacement.end + 1;
    }
    return output + chars.slice(cursor).join('');
  }
  return {fix};
}

const defaultVerifier = createItemNameVerifier();
export function fixItemNames(text, contextNames = []) {
  return defaultVerifier.fix(text, contextNames);
}
