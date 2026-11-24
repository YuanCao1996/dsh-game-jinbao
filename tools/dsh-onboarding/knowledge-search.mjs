// 大乱斗十人胜率是 10 条极小的快照查询，却和「海克斯排名」共用同一套节流：
// 每条要等 120ms 才排到下一个，冷启动光排队就 1.4 秒，页面一直「—」。
// 给这类按英雄取快照的查询单独开一条车道：并发 4、间隔 20ms，仍然走同一份缓存与 429 退避。
const isRosterSnapshot = query => query?.dataset === 'aram-ranking';
// Priority 0/1: augment choices (reserve a lane, independent of slow hero reads).
// 2: ordinary low-priority knowledge. 3: bulk roster snapshots.
const priorityOf = query => isRosterSnapshot(query) ? 3 : query?.filter?._type === 'augments' ? (query.filter.name ? 0 : 1) : 2;
// 「海克斯三选一」开面板时最多同时要 3 条按名字的排名；沿用 120ms 间隔会让卡片
// 的 No./T 值分 3 批到（实测 400–700ms）。这类按名字的单卡查询间隔缩短到 40ms。
export function createKnowledgeSearch(search,{now=Date.now,ttlMs=600000,spacingMs=120,hotSpacingMs=40,bulkSpacingMs=20,bulkConcurrency=4}={}){
 const cache=new Map(),pending=new Map(),queue=[];let blockedUntil=0,running=0,lowRunning=0,bulkRunning=0,nextStart=0,bulkNextStart=0,timer,closed=false;
 function pump(){
  clearTimeout(timer);timer=null;
  if(closed)return;
  if(now()<blockedUntil){for(const item of queue.splice(0)){pending.delete(item.key);item.reject(Object.assign(Error('Knowledge search backoff'),{status:429}));}return;}
  queue.sort((a,b)=>a.priority-b.priority);
  const start=item=>{
   const bulk=item.priority===3;
   running++;if(bulk)bulkRunning++;else if(item.priority>=2)lowRunning++;
   if(bulk)bulkNextStart=now()+bulkSpacingMs;else nextStart=now()+(item.priority===0?hotSpacingMs:spacingMs);
   Promise.resolve().then(()=>search(item.query)).then(value=>{
    if(value?.results?.length){cache.set(item.key,{at:now(),value:structuredClone(value)});if(cache.size>512)cache.delete(cache.keys().next().value);}item.resolve(value);
   },error=>{if(error.status===429)blockedUntil=now()+60000;item.reject(error);}).finally(()=>{
    running--;if(bulk)bulkRunning--;else if(item.priority>=2)lowRunning--;pending.delete(item.key);pump();
   });
  };
  // Regular lane: bulk reads never take its slots. 3 slots let the three augment
  // cards fan out together; ordinary low-priority lookups still run one at a time.
  while(running-bulkRunning<3&&queue.some(item=>item.priority<3)){
   const index=queue.findIndex(item=>item.priority<3&&(item.priority<2||lowRunning===0));if(index<0)break;
   if(nextStart>now())break;
   start(queue.splice(index,1)[0]);
  }
  while(bulkRunning<bulkConcurrency&&queue.some(item=>item.priority===3)){
   const index=queue.findIndex(item=>item.priority===3);if(index<0)break;
   if(bulkNextStart>now())break;
   start(queue.splice(index,1)[0]);
  }
  // Wake up for a lane that is only waiting on its spacing timer.
  const waits=[];
  if(queue.some(item=>item.priority<3)&&nextStart>now())waits.push(nextStart-now());
  if(queue.some(item=>item.priority===3)&&bulkNextStart>now())waits.push(bulkNextStart-now());
  if(waits.length)timer=setTimeout(pump,Math.max(1,Math.min(...waits)));
 }
 const run=query=>{
  if(closed)return Promise.reject(Object.assign(Error('Search closed'),{status:503}));
  const key=JSON.stringify(query),saved=cache.get(key);
  if(saved&&now()-saved.at<ttlMs)return Promise.resolve(structuredClone(saved.value));
  if(pending.has(key))return pending.get(key);
  const task=new Promise((resolve,reject)=>queue.push({key,query,priority:priorityOf(query),resolve,reject}));pending.set(key,task);queueMicrotask(pump);return task;
 };
 run.clear=()=>cache.clear();run.close=()=>{closed=true;clearTimeout(timer);for(const item of queue.splice(0)){pending.delete(item.key);item.reject(Object.assign(Error('Search closed'),{status:503}));}};return run;
}
