import {isCompletedItem} from '../lol-companion/item-policy.mjs';
import {recordChoice} from './choice-reactions.mjs';
const clean=value=>typeof value==='string'?value.trim().slice(0,120):'';
export function progressSeconds(value,fallback=null){
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value;
  const m=typeof value==='string'&&/^(\d{1,3}):(\d{2})$/.exec(value);
  return m?Number(m[1])*60+Number(m[2]):fallback;
}
export function addProgressEvent(state,key,description,seconds,topic,kind,extra){
  if(state.events.some(e=>e.key===key))return;
  const time=Number.isFinite(seconds)&&seconds>=0?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(Math.floor(seconds%60)).padStart(2,'0'):'时间未知';
  // `kind` travels with the event so the Agent can tell an equipment change from an
  // augment confirmation without spending a query round-trip to find out.
  state.events.push({key,text:description,time,...(topic?{topic}:{}),...(typeof kind==='string'&&kind?{kind:kind.slice(0,40)}:{}),...(extra&&typeof extra==='object'?extra:{})});
  // 装备更新与聊天 OCR 都在事件流里之后，40 条会被瞬间刷掉关键事件，放到 200。
  state.events=state.events.slice(-200);
}
const heroes=state=>[state.me,...state.allies,...state.enemies].filter(p=>p?.champion);
const identity=value=>String(value??'').replace(/[\s·]/g,'').toLowerCase();
function namedHero(state,event){
  const name=clean(event.champion??event.championTitle);
  if(name)return name;
  const display=clean(event.display);
  return heroes(state).find(p=>display.includes(p.champion))?.champion??null;
}
function isOwn(state,event){
  if(event.who==='self'||event.side==='me')return true;
  if(['ally','enemy','other','unknown'].includes(event.who))return false;
  const names=[event.champion,event.championTitle].filter(Boolean).map(identity);
  return names.includes(identity(state.me.champion))&&!!state.me.champion;
}
export function projectProgressEvent(state,event){
  const seconds=progressSeconds(event.time??event.gameTime,state.gameSeconds);
  if(event.kind==='chat_events'){
    for(const message of Array.isArray(event.events)?event.events:[]){
      if(['purchase','augment_mutate','augment_picked','augment_picked_chat'].includes(message.kind))projectProgressEvent(state,{...message,gameTime:message.gameTime??seconds});
    }
  }
  if(event.kind==='purchase'){
    const hero=namedHero(state,event)??(isOwn(state,event)?state.me.champion:null),item=clean(event.item);
    if(state.game==='lol'&&!isCompletedItem({id:event.itemId,name:item}))return;
    addProgressEvent(state,JSON.stringify(['purchase',seconds,hero,item||event.itemId]),`${hero??'英雄未识别'}购买装备：${item||'装备名称未识别'}`,seconds,'equipment','purchase');
  }
  if(['augment_picked','augment_mutate','augment_picked_chat'].includes(event.kind)){
    const augment=clean(event.augment??event.name);if(!augment)return;
    const confirmed=event.confidence!=='low'&&event.source!=='ocr-inferred'&&event.source!=='countdown-default-confirmed';
    // Only an explicit manual confirmation or an explicit chat/log record may mark an
    // augment as owned. Attribution is never bypassed by a capture source.
    // 日志/聊天里已经点名到本人时，即使置信度标 low 也按“已选”消费：
    // 实测玩家自己的 augment_mutate 常被解析成 who=other/unknown + confidence=low，
    // 但英雄名对得上，只展示不消费会让“本局已选”漏卡。
    const selfIdentity=identity(state.me.champion);
    const namedSelf=[event.champion,event.championTitle].filter(Boolean).map(identity).includes(selfIdentity)&&!!state.me.champion;
    const identified=isOwn(state,event)||(event.who!=='ally'&&event.who!=='enemy'&&namedSelf);
    const own=identified&&(confirmed||event.source==='log-confirmed');
    const hero=namedHero(state,event),owner=own?'自己':hero??'归属未确认';
    addProgressEvent(state,JSON.stringify(['augment',event.kind,owner,augment,confirmed]),`海克斯选择：${owner} · ${augment}`,seconds,'augment-selection',event.kind);
    if(own&&!state.ownedAugments.includes(augment))state.ownedAugments.push(augment);
  // 队友/敌方的选择也消费成结构化记录（同“敌方出装事件”），供时间线与模型事实使用。
  // ownedAugments 仍然只装本人，避免把队友强化算到自己头上。
  const heroTitle=hero??event.champion??event.championTitle??'';
  const heroId=identity(heroTitle);
  const side=own?'self':state.enemies.some(player=>identity(player.champion)===heroId)?'enemy':state.allies.some(player=>identity(player.champion)===heroId)?'ally':'unknown';
  if(heroTitle||augment){
   const selections=state.augmentSelections??(state.augmentSelections=[]);
   const key=JSON.stringify([event.kind,heroId,augment,seconds]);
   if(!selections.some(row=>row.key===key)){
    selections.push({key,at:Date.now(),gameSeconds:seconds,hero:String(heroTitle),side,augment,confirmed,source:String(event.source??'')});
    state.augmentSelections=selections.slice(-24);
    // 敌方高威胁强化：像敌方关键成装一样立刻喊一句。
    if(side==='enemy'&&HIGH_THREAT_AUGMENTS.has(augment)){
     const alertText='敌方'+String(heroTitle||'敌人')+'选了'+augment+'，要小心这个强化！';
     const recent=(state.broadcasts??[]).some(row=>row&&row.text===alertText&&Date.now()-Number(row.at||0)<120000);
     if(!recent)state.broadcasts=[...(state.broadcasts??[]),{at:Date.now(),text:alertText,priority:3,localAlert:true,expiresAt:Date.now()+15000}].slice(-12);
    }
   }
  }
    // A countdown-default pick is what the player actually ended up with, even though it
    // is not a user choice. Keep it separately so advice can account for it and label it.
    if(isOwn(state,event)&&event.source==='countdown-default-confirmed'&&event.confidence!=='low'){
      state.revealedAugments=state.revealedAugments??[];
      if(!state.revealedAugments.includes(augment))state.revealedAugments.push(augment);
    }
  }
  if(event.kind==='augment_offer'){
    const names=state.offers.map(o=>clean(typeof o==='string'?o:o.name)).filter(Boolean);
    if(names.length)addProgressEvent(state,JSON.stringify(['offers',event.roll,names]),`${event.reroll?'海克斯刷新':'海克斯三选一'}：${names.join('、')}`,seconds,undefined,'augment_offer');
  }
  if(event.kind==='augment_offer_closed')addProgressEvent(state,'offer-closed:'+event.roll,'海克斯面板关闭，等待确认选择结果',seconds,undefined,'augment_offer_closed');
}
// 敌方关键成装的即时提醒：查资料、问模型都要几十秒，而"跳不跳一个中娅的岩雀"
// 是当场就要做的决定。这里用本地规则先说一句，模型的完整分析随后再补。
const THREAT_RULES=[
 {test:/中娅|沙漏/,reason:'别先手跳她'},
 {test:/兰德里/,reason:'别贴着兵线打'},
 {test:/荆棘/,reason:'别硬接普攻'},
 // 只认水银饰带（解控）：水银之靴是常见的魔抗鞋，报成「出了水银」既含糊又误导。
 {test:/水银饰带/,reason:'控制技能留一手'},
 {test:/无尽|死亡之帽/,reason:'爆发起来了，要小心！'},
 {test:/救赎|钢铁烈阳/,reason:'有保命装，别硬上'},
];
export function threatAlerts(state,hero,added){
 const now=Number(state.at)||Date.now();
 const alerts=[];
 for(const item of added){
  const bare=String(item).replace(/ ×\d+$/,'');
 const rule=THREAT_RULES.find(r=>r.test.test(bare));
  if(!rule)continue;
  const text=hero+'出了'+bare+'，'+rule.reason;
  const recent=(state.broadcasts??[]).some(b=>b&&b.text===text&&now-Number(b.at||0)<120000);
  if(recent)continue;
  alerts.push(text);
 }
 return alerts;
}

// 敌方选了这些强化时立刻提醒，并触发一条针对建议。
// 先按已知高威胁名单兜底；后续拿到适配排名可以再细化。
export const HIGH_THREAT_AUGMENTS=new Set([
 '珠光护手','终极唤醒','魔法转物理','双刀流','巨人杀手','沃格勒特的巫师帽','钢化你心',
 '科学狂人','逃跑计划','缩小引擎','扳机炼狱','炼狱龙魂','下雪天','最终形态','飞升仪式',
 '全套武装','大地觉醒','物理转魔法','心灵弹幕','超负荷','终极符文','加速死亡',
]);

export function observeEquipment(state){
  const seen=new Set();
  for(const player of heroes(state)){
    const key=player.championAlias||player.champion;if(seen.has(key))continue;seen.add(key);
    const current=new Map();
    for(const item of Array.isArray(player.items)?player.items:[]){
      const name=clean(typeof item==='string'?item:item?.name);if(!name)continue;
      const id=String(item?.id??name),count=Number.isFinite(item?.count)&&item.count>0?item.count:1;
      const old=current.get(id);current.set(id,{name,count:count+(old?.count??0),completed:state.game!=='lol'||isCompletedItem(item)});
    }
    const previous=state.equipmentSnapshots.get(key);state.equipmentSnapshots.set(key,current);
    if(!previous)continue; // First observation is a baseline, never a fabricated purchase.
    const added=[],removed=[],addedRows=[];
    for(const [id,item] of current){const n=item.count-(previous.get(id)?.count??0);if(n>0&&item.completed){added.push(item.name+(n>1?' ×'+n:''));addedRows.push({id:String(id),name:item.name,count:n});}}
    // 买装备的反馈：日志里没有 purchase 事件，只能靠 items 差分发现「多了一件成装」。
    if(player===state.me&&added.length){
      for(const name of added){
        const bare=name.replace(/ ×\d+$/,'');
        if(bare)recordChoice(state,{kind:'item',name:bare,at:Number(state.at)||Date.now()});
      }
    }
    for(const [id,item] of previous){const n=item.count-(current.get(id)?.count??0);if(n>0&&item.completed)removed.push(item.name+(n>1?' ×'+n:''));}
    if(added.length&&state.enemies.includes(player)){
      state.completedEquipmentEvents=[...(state.completedEquipmentEvents??[]),{at:state.at,time:state.gameSeconds,hero:player.champion,items:added,itemRows:addedRows}].slice(-12);
      // 关键装备立刻说一句，不用等模型（实测中娅那次等了约 3 分钟）。
      for(const text of threatAlerts(state,player.champion,added)){
        const row=addedRows.find(item=>item?.name&&text.includes(String(item.name)))??null;
        state.broadcasts=[...(state.broadcasts??[]),{at:Number(state.at)||Date.now(),text,priority:2,localAlert:true,expiresAt:(Number(state.at)||Date.now())+15000,
          ...(row?{equipment:{hero:player.champion,items:[{id:String(row.id),name:String(row.name)}]}}:{})}].slice(-12);
      }
    }
    if(added.length||removed.length)addProgressEvent(state,JSON.stringify(['inventory',key,state.at,added,removed]),`装备更新：${player.champion}`+(added.length?' · 新增 '+added.join('、'):'')+(removed.length?' · 移除 '+removed.join('、'):''),state.gameSeconds,'equipment','inventory',
      state.enemies.includes(player)&&addedRows.length?{equipment:{hero:player.champion,items:addedRows}}:undefined);
  }
}
