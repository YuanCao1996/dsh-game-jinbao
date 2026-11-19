export { roles, roleById, roleInstruction } from '../shared/game-roles.mjs';
export function speechSegments(value,limit=6){
 const text=String(value??'').slice(0,6000).replace(/```[\s\S]*?```/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/\b(?:Bearer\s+|(?:api[_ -]?key|token|secret|password)\s*[:=]\s*)\S+/gi,'凭据已隐藏').replace(/\bsk-[\w-]+/g,'凭据已隐藏').replace(/[*#`>|]/g,'').trim();
 const parts=[];let pending='';
 for(const phrase of text.match(/[^。！？；!?;\n]+[。！？；!?;\n]?/g)??[]){
  if(pending.length+phrase.length>85&&pending){parts.push(pending.trim());pending='';}
  pending+=phrase;while(pending.length>100){parts.push(pending.slice(0,85));pending=pending.slice(85);}
 }
 if(pending.trim())parts.push(pending.trim());return parts.filter(Boolean).slice(0,limit);
}
export const speechPause=text=>/[。！？；!?]$/.test(text?.trim()??'')?360:220;
// TTS 读法修正：屏幕上的写法（No.20、｜、vs）念出来会变成 N O 或停顿，
// 这里统一转成中文口语；显示文本不动，只影响朗读。
export function speakable(value){
  return String(value ?? '')
    .replace(/No\.\s*(\d+)/gi, '第$1名')
    .replace(/No\.?/gi, '排名')
    .replace(/\s*[｜|]\s*/g, '，')
    .replace(/\s*vs\.?\s*/gi, ' 对 ')
    .replace(/\s*[·•]\s*/g, '，')
    .replace(/[（(]/g, '，').replace(/[）)]/g, '，')
    .replace(/\s*→\s*/g, ' 到 ')
    .replace(/，{2,}/g, '，')
    // 收尾的逗号念出来会留一个空停顿
    .replace(/[，,、]+$/, '')
    .trim();
}
// Do not cut an equipment/augment name or spend another model request summarizing.
// 朗读前先过 speakable：No.20 会被念成「N O 20」，而胶囊/短讯里这种写法很常见。
// 出装与强化建议普遍 80~150 字，直接念会被 60 字上限整条丢掉（实测 17 条出装建议只有 1 条出声）。
// 先抽出玩家真正要执行的那一处，再交给 briefSpeech，保证关键时刻听得到重点。
function buildSpeechLine(value){
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  // 一、下一件 / 优先做 X（最常见，也最该被听到）
  const marker = /(?:下一件|下一次可购买|下次可购买|优先做|优先买|先买|先做|直接合成)/.exec(text);
  if (marker) {
    let rest = text.slice(marker.index + marker[0].length);
    rest = rest.replace(/^[^：:]{0,4}[：:]/, "").replace(/^(优先|直接|继续|也|就|再|合成|合|做|买|出|补)+/, "").replace(/^[的\s]+/, "");
    const name = rest.split(/[，。；：（(—\-、]/)[0].trim();
    if (name && name.length <= 10 && !/[→到]/.test(name)) return "下一件 " + name;
  }
  // 二、六件顺序 / 出装顺序：念前三件就够
  if (text.includes("→")) {
    const parts = text.split("→").map(seg => seg
      .replace(/^[\s\S]*(?:顺序|出装|开局)[：:\s]*/, "")
      .replace(/[（(].*$/, "")
      .split(/[，。；：、]/)[0]
      .replace(/^[\d+\s件、]+/, "")
      .replace(/^(先做|先|再做|做|出|买|合成|合|补|升级|转)+/, "")
      .trim())
      .filter(Boolean)
      .slice(0, 3);
    if (parts.length) return "出装 " + parts.join("、");
  }
  // 三、强化后的打法：念第一段动作
  const play = /(?:怎么玩|打法)[：:]\s*([^；。]{4,26})/.exec(text);
  if (play) return play[1].trim();
  return text;
}

// TTS 前清理：界面上的分类前缀与分隔符念出来很怪（"已选海克斯 · 珠光护手"）。
// 只影响朗读，界面文本保持原样。
const SPOKEN_PREFIX=/^(?:已选海克斯|装备更新|本局已选|我方阵容|敌方阵容|阵容|局势估计|对局|当前对局|关键事件|补充说明)\s*[·：:，,]?\s*/;
export function stripSpokenPrefixes(value){
 return String(value ?? '')
  .replace(/【[^】]{0,24}】/g,'')
  .replace(/(?:\s*·\s*)/g,'，')
  .replace(SPOKEN_PREFIX,'')
  .replace(/\s{2,}/g,' ')
  .trim();
}

// 「下一步买什么」这类可执行句子比描述性首句更该被听到（2026-11-18 实测：
// 「先用雪球贴脸…往前压吧。下次购买优先帽子、中亚呀。」念到分句就停，购买建议整条丢了）。
const ACTIONABLE=/(?:购买|下一件|买|合成|出装|先出|攒钱|攒|换装|替换)/;
function speechChars(value){return Array.from(String(value??""));}
function trimTo(value,limit){
 const all=speechChars(value).join("");
 const chars=speechChars(all).slice(0,Math.max(1,limit)).join("");
 if(chars.length>=speechChars(all).length)return chars;
 const head=chars.slice(0,Math.max(1,limit-1));
 const cut=Math.max(head.lastIndexOf("，"),head.lastIndexOf("、"),head.lastIndexOf("；"),head.lastIndexOf(","));
 const keep=cut>=Math.max(8,Math.floor(limit*0.35))?head.slice(0,cut):head;
 return keep.replace(/[，,、；;\s]+$/,"")+"…";
}
export function briefSpeech(value,maxChars=60){
 // 优先级（都有真实事故支撑）：
 // 1. 一两个短句能一口气念完就都念 —— 只念首句会把「下次购买…」这种关键信息切掉。
 // 2. 首句太长时，若后一句是「买什么/合什么」的短句，优先把它念出来。
 // 3. 首句过长则在标点处截断加省略号，不再整句丢弃。
 // 4. 完全没有句读的超长文本视为噪声，不念。
 const limit=Math.max(12,maxChars);
 const text=speechSegments(speakable(stripSpokenPrefixes(buildSpeechLine(value))),80).join("").trim();
 if(!text)return "";
 const sentences=(text.match(/[^。！？!?]+[。！？!?]?/g)??[text]).map(s=>s.trim()).filter(Boolean);
 const joined=sentences.slice(0,2).join("");
 if(joined&&speechChars(joined).length<=limit)return joined;
 const actionable=sentences.slice(1).find(s=>ACTIONABLE.test(s))??"";
 if(actionable&&speechChars(actionable).length<=Math.max(12,Math.round(limit*0.7))){
  const room=limit-speechChars(actionable).length;
  const head=room>=10?trimTo(sentences[0]??"",room).replace(/…$/,"，"):"";
  return (head+actionable).trim();
 }
 const first=sentences[0]??text;
 if(speechChars(first).length<=limit)return first;
 if(!/[。！？!?]/.test(text))return "";
 return trimTo(first,limit);
}
