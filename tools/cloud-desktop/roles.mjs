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
export function briefSpeech(value,maxChars=80){
 const text=speechSegments(speakable(value),80).join('');let result='';
 for(const sentence of text.match(/[^。！？!?]+[。！？!?]?/g)??[]){
  const clean=sentence.trim();if(!clean||clean.length>maxChars)continue;
  if(result.length+clean.length>maxChars)break;result+=clean;
  if((result.match(/[。！？!?]/g)??[]).length>=2)break;
 }
 return result;
}
