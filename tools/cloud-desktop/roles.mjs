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
export function briefSpeech(value,maxChars=60){
 // 三条规则（都有真实事故支撑）：
 // 1. 只念屏幕上的「开头」，听到的和看到的才对得上（旧实现会跳过超长首句去念后面那句，
 //    实测 113→65、524→58）。
 // 2. 首句过长时在标点处截断加省略号，不再整句丢弃。
 // 3. 完全没有任何句读的超长文本（例如 200 个同字）视为噪声，不念 —— 避免把一坨文字塞给 TTS。
 const limit=Math.max(12,maxChars);
 const text=speechSegments(speakable(value),80).join('').trim();
 if(!text)return '';
 const first=(text.match(/^[^。！？!?]*[。！？!?]?/)??[''])[0].trim()||text;
 if(first.length<=limit)return first;
 if(!/[。！？!?]/.test(text))return '';
 const head=first.slice(0,limit-1);
 const cut=Math.max(head.lastIndexOf('，'),head.lastIndexOf('、'),head.lastIndexOf('；'),head.lastIndexOf(','));
 const keep=cut>=Math.max(8,Math.floor(limit*0.35))?head.slice(0,cut):head;
 return keep.replace(/[，,、；;\s]+$/,'')+'…';
}
