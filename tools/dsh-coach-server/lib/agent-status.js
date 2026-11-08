import {writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
// 工具名 → 一句人话：功能播报（“已处理画面请求”）读起来像日志，这里换成玩家看得懂的表述。
// 进行时短语：单行面板只显示这一句，长度控制在 12 字以内，避免被省略号截断。
const ACTIONS={
 inspect_latest_screen:'看一眼游戏画面',
 game_log_query:'翻翻这局的日志',
 query_match_events:'查这局的关键事件',
 query_current_match_events:'查这局的关键事件',
 get_current_match_state:'看一下当前局势',
 get_lineup_context:'看一下双方阵容',
 get_recent_match_events:'回想刚才发生了什么',
 site_query:'翻一下资料库',
 site_datasets:'看看能查哪些资料',
 web_search:'上网查一下',
 web_fetch:'打开一个网页看看',
 search_local_knowledge:'查一下本地资料',
 game_memory_query:'回想一下之前的局',
 game_memory_save:'记住这个偏好',
 coach_reply:'组织一下说法',
};
// 未知工具也要像人说话，不要退回“整理回答”。
const FALLBACK_ACTION='理一下思路';
const copy=phrase=>{const text=String(phrase??'');return text.length>24?text.slice(0,24):text;};
const queues=new Map();
export function createAgentStatus(stateDir,game,match){
 let last=Promise.resolve();
 return (phase,name)=>{
  // 失败原因必须原样透出：它比任何文案优化都重要。
  const label=phase==='start'?'正在想这局该怎么打' :phase==='error'?'模型请求失败，等待恢复；可在设置查看诊断' :phase==='complete'?'' :phase==='tool'||name?copy(ACTIONS[name]??FALLBACK_ACTION)+'…' :'理一下思路';
  const value={game,match,phase,label,at:Date.now()};
  last=(queues.get(stateDir)??last).catch(()=>{}).then(async()=>{await mkdir(stateDir,{recursive:true});const file=join(stateDir,'agent-status.json'),tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value),{mode:0o600});for(let attempt=0;;attempt++){try{await rename(tmp,file);break;}catch(error){if(attempt>=2||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await sleep(20);}}}finally{await rm(tmp,{force:true}).catch(()=>{});}}).catch(()=>{});
  queues.set(stateDir,last);const task=last;void task.finally(()=>{if(queues.get(stateDir)===task)queues.delete(stateDir);});return last;
 };
}
