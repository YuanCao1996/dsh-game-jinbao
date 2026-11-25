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


// 建议出口的“具体装备名”校验：
// 模型偶尔会造不存在的装备名，或只说“护甲装/保命装”这类方向词。
// 这里只认本局出现的装备、官方目录、常见简称；命中未知词尾或方向词就判可疑。
const ITEM_SLANG = new Set(['穿甲弓','巨九','贪九','破败','三相','无尽','帽子','大帽','金身','中娅','复活甲','蓝盾','板甲鞋','水银鞋','护甲鞋','魔抗鞋','法穿鞋','攻速鞋','三速鞋','五速鞋','CD鞋','冰杖','卢登','影焰','面具','鬼书','法穿棒','日炎','反甲','兰盾','狂徒','血手','饮血','巨杀','重伤','坩埚','圣杯','香炉','鸟盾','石像鬼','正义荣耀','救赎','骑士之誓','基克','皇冠','号令之旗','干扰水晶','号角'].map(normalize));
const GENERIC_ITEM_WORDS = new Set(['成装','装备','散件','小件','组件','道具','物品','防装','护甲装','法系装','物理装','输出装','保命装','肉装','坦克装','ap装','ad装']);
const ITEM_SUFFIX = /(?:之[刃弓杖书戒泪镜眼牙心镰斧锤枪盾帽盔]|胫甲|战锤|巨剑|长剑|短剑|轻语|法杖|权杖|魔杖|护符|腰带|斗篷|披风|头盔|胸甲|板甲|重甲|铠甲|护甲|手甲|臂甲|手套|靴子|战靴|之靴|鞋子|之鞋|药水|药剂|宝石|项链|戒指|法冠|弓|刃|杖|剑|刀|锤|甲|鞋|靴|书|戒|符|带|篷|盔|冠|盾|枪|炮|弩|爪|环|坠|链|珠|镜|壶|瓶|袍|斧|棍|棒|鞭|钩|镰|矛|戟|箭|弹|匣|箱|袋|石|晶|玉|印|卷|轴|旗|徽|章|牌|令|典|册)$/;
const ITEM_SPLIT = /[^\u4e00-\u9fa5]+|(?:下一件|下件|还是|优先|先|再|就|也|直接|能买|能|买|补|做|出|合成|合|一件|一个|个|把|件|成装|装备|组件|散件|小件|的|了|吧|哦|啦|呀|嘛|呢|啊)/g;
export function unknownItemMentions(text, contextNames = []) {
 const source = String(text ?? '');
 if (!source || !/[\u4e00-\u9fa5]/.test(source)) return '';
 const known = new Set([...CATALOG, ...(Array.isArray(contextNames) ? contextNames : []), ...ITEM_SLANG].map(normalize).filter(Boolean));
 const segments = source.split(ITEM_SPLIT).filter(Boolean);
 for (const segment of segments) {
  const key = normalize(segment);
  if (!key || known.has(key)) continue;
  if (GENERIC_ITEM_WORDS.has(key.toLowerCase())) return segment;
  if (ITEM_SUFFIX.test(segment)) return segment;
 }
 return '';
}

const defaultVerifier = createItemNameVerifier();
export function fixItemNames(text, contextNames = []) {
  return defaultVerifier.fix(text, contextNames);
}
