// 观众提问的本地应答：主播模式里观众问得最多的是"出装/战绩/对面/海克斯/多少钱"。
// 模型往返 3–6 秒且要钱，而弹幕节奏等不起；这里用当前对局事实做确定性回答，40 字以内。
// 说不准的就说不知道，绝不编数据。

const ITEM_HINTS = /出装|装备|买什么|买啥|下一件|怎么出/;
const KDA_HINTS = /战绩|kda|几个人头|杀了几|数据|多少杀/i;
const ENEMY_HINTS = /对面|敌方|他们|敌人/;
const AUGMENT_HINTS = /海克斯|强化|三选一|选哪个/;
const GOLD_HINTS = /金币|多少钱|经济|多少金/;

const pickOf = (list, seed) => list[Math.abs(Number(seed) || 0) % list.length];

export function viewerReply(question, facts = {}, seed = 0) {
  const text = String(question ?? '').trim();
  const greeting=text.replace(/@?金宝/g,'').trim();
  if(/^(你好[呀啊哇]?|您好|哈喽|嗨|hello|hi)[\s!！。~～]*$/i.test(greeting))return pickOf(['你好呀，欢迎来直播间！','嗨，欢迎！想聊这局就直接问我。'],seed);
  if(/^(谢谢[你啦啊]?|多谢|感谢|thanks)[\s!！。~～]*$/i.test(greeting))return '不客气，一起看这局！';
  const champion = String(facts.champion ?? '').trim();
  const kda = Array.isArray(facts.kda) ? facts.kda.join('/') : '';
  const gold = facts.gold!==null&&facts.gold!==undefined&&facts.gold!==''&&Number.isFinite(Number(facts.gold)) ? Number(facts.gold) : null;
  const next = String(facts.nextItem ?? '').trim();
  const items = Array.isArray(facts.items) ? facts.items.filter(Boolean) : [];
  const augments = Array.isArray(facts.augments) ? facts.augments.filter(Boolean) : [];
  const enemies = Array.isArray(facts.enemies) ? facts.enemies.filter(Boolean) : [];

  if (KDA_HINTS.test(text) && kda) {
    return pickOf([`现在是 ${kda}，${champion || '这英雄'}还在打。`, `${champion || '我'}现在是 ${kda}。`], seed);
  }
  if (GOLD_HINTS.test(text) && gold !== null) {
    return pickOf([`金币 ${gold}，还能再攒一件。`, `现在 ${gold} 金，够不够看下一件。`], seed);
  }
  if (ITEM_HINTS.test(text)) {
    if (next) return pickOf([`下一件推荐 ${next}。`, `按计划下一件是 ${next}。`], seed);
    if (items.length) return `目前出了 ${items.slice(-2).join('、')}，下一件等局面再定。`;
    return '暂未读取到装备，不能确定下一件。';
  }
  if (AUGMENT_HINTS.test(text)) {
    if (augments.length) return `这局拿了 ${augments.join('、')}。`;
    return '暂未读取到已选海克斯，不能确认。';
  }
  if (ENEMY_HINTS.test(text) && enemies.length) {
    return `对面有 ${enemies.slice(0, 4).join('、')}，盯住最肥的那个。`;
  }
  return '这个问题还缺少对局信息，暂时不能确定。';
}
