import {parseChat,AUGMENT_VERB_RE} from './chat.mjs';
import {correctMessage,snapInText} from './chat-correct.mjs';
const normalized=value=>String(value??'').replace(/[\s:：!！·•,，。.]/g,'').toLowerCase();
function lookup(map,value){
  if(value.startsWith('~fix~'))return null;
  if(value.startsWith('~prefix~')){
    const prefix=normalized(value.slice(8));if(prefix.length<2)return null;
    const matches=[...map].filter(([key])=>key.startsWith(prefix));
    return matches.length===1?matches[0][1].name:null;
  }
  return map.get(normalized(value))??null;
}
export function createChatObserver(augmentNames,emit,{now=Date.now}={}){
  let champions=[],items=[],seen=new Map();
  const augments=new Map(augmentNames.map(name=>[normalized(name),{name}]));
  return {
    reset(){seen.clear();},
    setCatalog(catalog){champions=catalog.champions??champions;items=catalog.items??items;},
    observe(frame,state){
      if(!frame?.available||!frame.foreground||!state)return;
      // 采集脚本返回的是 chatLines（聊天区裁剪后的行），历史字段名还有 chatOnly；
      // 测试与旧调用方直接给 lines。三个都接受，否则聊天会被静默跳过。
      const source=Array.isArray(frame.chatOnly)?frame.chatOnly
        :Array.isArray(frame.chatLines)?frame.chatLines
        :Array.isArray(frame.lines)?frame.lines:[];
      return this.observeLines(source,state,frame);
    },
    // 云端补读回来的行走同一条解析/纠错链路；box 由调用方合成，只要落在聊天区内即可。
    observeLines(source,state,frame){
      if(!state||!Array.isArray(source)||!source.length)return;
      const aliases=new Map();
      for(const c of champions)for(const name of [c.name,c.alias])if(name)aliases.set(normalized(name),c.name);
      const players=[state.me,...state.allies,...state.enemies].filter(p=>p?.champion);
      for(const p of players){const canonical=aliases.get(normalized(p.championAlias))??p.champion;for(const name of [p.champion,p.championAlias])if(name)aliases.set(normalized(name),canonical);}
      const itemMap=new Map(items.filter(i=>i?.name).map(i=>[normalized(i.name),i]));
      for(const p of players)for(const item of p.items??[])if(item?.name)itemMap.set(normalized(item.name),item);
      const championsInText=value=>{
        const text=normalized(value),hits=[];
        for(const [alias,name] of aliases){const at=text.indexOf(alias);if(at>=0)hits.push({name,at});}
        return [...new Set(hits.sort((a,b)=>a.at-b.at).map(h=>h.name))];
      };
      // 只解析聊天区裁出来的行：整屏 OCR 里混着技能说明、加载页提示，以前会被当成「队友说话」。
 const lines=source.filter(line=>Array.isArray(line.box)).map(line=>({...line,text:String(line.text??'').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1').replace(/(\d)\s*[:：]\s*(\d)/g,'$1:$2')}));
      // 解析前先把整行里的名字纠回来：OCR 认错一个字的英雄名会让整行变成 other 被丢掉。
 const rosterNames=[...new Set([state.me,...(state.allies??[]),...(state.enemies??[])]
  .flatMap(p=>[p?.riotId,p?.summonerName]).filter(name=>typeof name==='string'&&name.trim()))];
 const championNames=[...new Set([...aliases.values()])];
 const fixedLines=lines.map(line=>{
  const text=String(line.text??'');
  if(!text)return line;
  return {...line,text:snapInText(snapInText(text,rosterNames,1),championNames,2)};
 });
 const messages=parseChat(fixedLines,{width:frame.width,height:frame.height,
        championsInText,isChampion:value=>aliases.has(normalized(value)),championFix:value=>aliases.get(normalized(value))??null,
        augmentLookup:value=>lookup(augments,value),itemLookup:value=>lookup(itemMap,value),
        augmentsInText:value=>{
          const text=normalized(value);
          const hits=[...augments].filter(([key])=>text.includes(key));
          // 虹吸 is a substring of 灵魂虹吸 (and 棱彩阶 of 质变：棱彩阶), so a single
          // announcement matched two catalog entries and emitted two events. Keep only
          // the longest matching name.
          return hits.filter(([key])=>!hits.some(([other])=>other!==key&&other.includes(key))).map(([,row])=>row.name);
        },
      });
      // OCR 结果先校验/纠错：时间前缀坏的、名字对不上本局名单的、乱码太多的，直接丢。
 const rosterPlayers=[state.me,...(state.allies??[]),...(state.enemies??[])]
  .flatMap(p=>[p?.riotId,p?.summonerName,p?.champion])
  .filter(name=>typeof name==='string'&&name.trim());
 const messages2=messages.map(message=>correctMessage(message,{
  clock:Number(state.gameSeconds),
  players:[...new Set(rosterPlayers)],
  champions:[...new Set([...aliases.values()])],
  augments:[...augments.values()].map(row=>row.name),
  items:[...itemMap.values()].map(row=>row.name).filter(Boolean),
 })).filter(Boolean);
 for(const message of messages2){
        if(!['purchase','augment_mutate','augment_picked_chat','team_chat','ping'].includes(message.kind))continue;
        // Chat attribution must read the raw line. The in-game format is
        // "玩家名（英雄）已质变了…", so stripping the bracketed prefix before looking
        // for the champion loses the owner, and when the augment itself is bracketed
        // the greedy strip also swallows the verb, forcing every line to low confidence.
        const raw=String(message.text??'');
        const verbAt=raw.search(AUGMENT_VERB_RE);
        const beforeVerb=verbAt>=0?raw.slice(0,verbAt):raw;
        // 客户端在公告里会用「你」代替自己的英雄名（实测 2026-11-12 狂厄蔷薇那局：
        // 「你 已质变了 X」拿不到 champion，归属变成 unknown，于是本局已选永远为空）。
        // 只认主语以「你」开头，「你们」这类他人措辞不算。
        const ownName=aliases.get(normalized(state.me?.championAlias))??aliases.get(normalized(state.me?.champion))??state.me?.champion;
        const selfSubject=/^你(?!们)/.test(normalized(beforeVerb));
        const explicit=championsInText(beforeVerb).at(-1);
        const champion=explicit??message.champion??(selfSubject&&ownName?ownName:null);
        const time=message.time??null;
        // 同一英雄可能同时出现在双方阵容里（自定义/克隆/人机常见）。只看英雄名会把
        // 队友的「XXX（深渊巨口）已质变了…」算到本人头上，污染本局已选并让模型按错误强化出装。
        // 只有出现明确的本人证据（主语「你」或说话人是本人）才认 self；否则归为 other。
        const ownChampion=normalized(state.me?.champion);
        const selfName=normalized(state.me?.riotId??state.me?.summonerName??'');
        const roster=[state.me,...(state.allies??[]),...(state.enemies??[])].filter(Boolean);
        const duplicateOwnChampion=!!ownChampion&&roster.filter(player=>normalized(player.champion)===ownChampion).length>1;
        const selfSpeaker=!!message.speaker&&!!selfName&&normalized(message.speaker)===selfName;
        const otherPlayerNamed=roster.some(player=>[player.riotId,player.summonerName].filter(Boolean).map(normalized).some(playerName=>playerName!==selfName&&normalized(raw).includes(playerName)));
        const selfEvidence=selfSubject||selfSpeaker;
        // 队友/自己的聊天与信号：解析器已经分出说话人，直接上报，不参与海克斯归属推断。
 if(message.kind==='team_chat'||message.kind==='ping'){
  const chatText=message.kind==='ping'?'点了信号':String(message.content??'').trim().slice(0,160);
  if(!chatText)continue;
  const chatKey=message.kind+'|'+chatText;
  const chatAt=now();
  const chatLast=seen.get(chatKey);
  // 同一句话会在连续几帧里被重复读到；30 秒内只报一次。
  if(chatLast!==undefined&&chatAt-chatLast<30000)continue;
  seen.set(chatKey,chatAt);
  const speaker=message.speaker??null;
  const selfName=String(state.me?.riotId??state.me?.summonerName??'').trim();
  const self=!!speaker&&!!selfName&&normalized(speaker)===normalized(selfName);
  emit({kind:'chat_events',gameTime:state.gameTime,events:[{kind:message.kind,time:message.time??null,speaker,text:chatText,champion:message.champion??null,self}]});
  continue;
 }
 const names=message.kind==='purchase'?[message.item??null]:message.augments??[message.augment];
        // The parser already proved the verb was there; re-testing the joined line used to
        // disagree whenever OCR split the verb across boxes, which silently downgraded
        // every such record to low confidence and dropped it from the owned list.
        const told=message.verb===true||AUGMENT_VERB_RE.test(raw);
        // OCR merges rows: one parsed line can carry the player's champion from one
        // announcement and another player's augment from the row below it. A real match
        // showed that producing "封魔剑魂 已质变了 最万用的瞄准镜" for an augment the player
        // never took, at high confidence, which polluted 本局已选. Only a line with a
        // single augment name may claim an owner; ambiguous merges stay unattributed.
        const ambiguousNames=message.kind!=='purchase'&&Array.isArray(names)&&names.filter(Boolean).length>1;
        const effectiveTold=told&&!ambiguousNames;
        const at=now();
        for(const name of names){
          if(message.kind!=='purchase'&&!augments.has(normalized(name)))continue;
          // The same announcement is re-read across frames, and the in-game time is
          // missing on some of those reads. Keying on the time therefore let one line
          // through repeatedly (大力 appeared five times in a single match), so the key
          // is the fact itself and a short window absorbs the re-reads.
          const key=JSON.stringify([message.kind,champion,name]);
          const last=seen.get(key);
          // Purchases may legitimately repeat within seconds (two of the same item), so
          // they only absorb immediate re-reads. Attributed augment picks are minutes
          // apart, so a wide window is safe; an unattributed one is shared by every
          // player in the match, so it must expire quickly or two players picking the
          // same augment collapse into a single event.
          // An attributed augment is unique per player and match, so a minute of re-reads
          // is still the same fact; unattributed lines are shared by everyone in the match
          // and must expire quickly or two players collapse into one event.
          // 无归属的识别被整局共享，窗口太短会让同一句话被重复上报（实测同一条出现 3 次），提到 30 秒。
          const window=message.kind==='purchase'?3000:champion?120000:30000;
          if(last!==undefined&&at-last<window)continue;
          seen.set(key,at);
          if(seen.size>512)seen.delete(seen.keys().next().value);
          if(message.kind==='purchase'){emit({kind:'chat_events',gameTime:state.gameTime,events:[{kind:'purchase',champion,time,item:name,itemRaw:message.itemRaw??null,itemId:message.itemId??null,itemUnresolved:!name}]});continue;}
          const championIsSelf=!!champion&&champion===ownName;
          // 重名英雄没有明确本人证据时，不能认 self（可能把队友的强化算进来）。
          const own=championIsSelf&&!ambiguousNames&&(selfEvidence||(!duplicateOwnChampion&&!otherPlayerNamed));
          const attributionUnknown=duplicateOwnChampion&&!selfEvidence&&!otherPlayerNamed;
          emit({kind:'augment_mutate',augment:augments.get(normalized(name)).name,champion,
            who:ambiguousNames||attributionUnknown?'unknown':!champion?'unknown':own?'self':'other',
            source:'log-confirmed',confidence:effectiveTold?'high':'low',verb:effectiveTold,time,gameTime:state.gameTime});
        }
      }
    },
  };
}
export function createChatCatalogReader(request){
  let lastPort=null,nextAttempt=0,busy=false;
  return async(credentials,accept)=>{
    if(busy||(lastPort===credentials.port&&Date.now()<nextAttempt))return;
    busy=true;lastPort=credentials.port;nextAttempt=Date.now()+60000;
    try{
      const results=await Promise.allSettled([
        request(credentials,'/lol-game-data/assets/v1/champion-summary.json'),
        request(credentials,'/lol-game-data/assets/v1/items.json'),
      ]);
      const data=results.map(r=>r.status==='fulfilled'&&r.value.status===200&&Array.isArray(r.value.data)?r.value.data:null);
      accept({...(data[0]?{champions:data[0]}:{}),...(data[1]?{items:data[1]}:{})});
      if(data.every(Boolean))nextAttempt=Infinity;
    }finally{busy=false;}
  };
}
