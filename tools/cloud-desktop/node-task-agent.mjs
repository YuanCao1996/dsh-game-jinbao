// Explicit private-node preview. No legacy fallback after task submission.
import {request as httpsRequest} from 'node:https';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const endpoint = 'https://www.jinbaoai.top/desktop/node-agent/v1/tasks';
const fail = (status, message, code) => Object.assign(Error(message), {status, code});

function officialFetch(url, options) {
  if (url !== endpoint) throw fail(400, 'Invalid task endpoint');
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {method: 'POST', headers: options.headers, signal: options.signal, timeout: 8000, rejectUnauthorized: true, agent: false}, res => {
      const chunks = []; let size = 0;
      res.on('data', part => { size += part.length; if (size > 4096) req.destroy(Error('Task response budget')); else chunks.push(part); });
      res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: res.statusCode, headers: {'content-type': res.headers['content-type'] ?? ''}})));
    });
    req.on('timeout', () => req.destroy(Error('Task transport timeout'))); req.on('error', reject); req.end(options.body);
  });
}

async function limitedJson(response) {
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) { await response.body?.cancel(); throw fail(502, 'Invalid task response'); }
  const reader = response.body?.getReader(); if (!reader) throw fail(502, 'Empty task response');
  let size = 0; const chunks = [];
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) { await reader.cancel(); throw fail(502, 'Task response budget'); } chunks.push(Buffer.from(part.value)); }
  } finally { reader.releaseLock(); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); }
  catch { throw fail(502, 'Invalid task response'); }
  if (!response.ok) throw Object.assign(fail(response.status, '节点服务暂不可用'), {notSubmitted: response.status === 503 && value.error === 'node_task_preview_closed'});
  return value;
}

export function createNodeTaskAgent({enabled = false, getToken, getBinding, isCurrent = () => true, onProgress = () => {}, fetchImpl = officialFetch, pollMs = 1000, timeoutMs = 90000, archivePollMs = 2000, archivePollLimit = 30} = {}) {
  const lifetime = new AbortController(); let busy = false, settled = Promise.resolve(), uncertain = false;
  const call = async (body, token, signal) => limitedJson(await fetchImpl(endpoint, {method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}));
  let archive=null, monitor=null;
  const publish=(item,state,reason)=>{
    if(archive!==item)return;
    if(item.state===state&&item.reason===reason)return;
    item.state=state;item.reason=reason;if(state==='ready'){item.token=null;item.ref=null;}
    try{onProgress({event:'archive_'+state,reason,game:item.game,match:item.match,topic:'chat',requestId:item.activityId});}catch{}
  };
  const watchArchive=(request,ref,token,initial)=>{
    if(!['pending','attention','unavailable'].includes(initial.archiveState))return;
    monitor?.controller.abort();
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,lifetime.signal]);
    const item={game:request.game,match:request.match,activityId:request.activityId,state:'pending',reason:undefined,ref,token};archive=item;
    const update=result=>{
      if(result.archiveState==='ready'){publish(item,'ready');return true;}
      if(result.archiveState==='attention')publish(item,'attention',['context_changed','delayed'].includes(result.archiveReason)?result.archiveReason:'delayed');
      else if(result.archiveState==='unavailable')publish(item,'attention','delayed');
      return false;
    };
    update(initial);
    const task=(async()=>{
      try{
        for(let n=0;n<archivePollLimit;n++){
          await sleep(archivePollMs,undefined,{signal});
          if(!isCurrent(item.game,item.match)||await getToken()!==token)return;
          try{
            const result=await call({action:'status',...ref},token,signal);
            if(signal.aborted||!isCurrent(item.game,item.match)||await getToken()!==token)return;
            if(result.taskId!==ref.taskId||result.budgetId!==ref.budgetId||result.state!=='completed')throw Error('archive_status_mismatch');
            if(update(result))return;
          }catch(error){if(signal.aborted)return;}
        }
        publish(item,'attention','delayed');
      }catch(error){if(!signal.aborted)publish(item,'attention','delayed');}
    })();
    const active={controller,task,finished:false};monitor=active;
    void task.finally(()=>{active.finished=true;});
  };
  return {
    busy: () => busy,
    archiveStatus: () => archive?{game:archive.game,match:archive.match,state:archive.state,...(archive.reason?{reason:archive.reason}:{})}:null,
    async ask(request) {
      if (!enabled || lifetime.signal.aborted) throw fail(503, '节点预览未启用');
      if (uncertain) throw fail(503, '上次任务状态未确认，请先重新连接');
      if (busy) throw fail(409, '已有任务正在处理');
      if (request.topic !== 'chat' || request.automatic === true || typeof request.question !== 'string' || !request.question.trim() || Buffer.byteLength(request.question) > 512) throw fail(413, '节点预览仅支持简短手动提问');
      if(archive&&(!isCurrent(archive.game,archive.match)||archive.game!==request.game||archive.match!==request.match)){monitor?.controller.abort();archive=null;}
      busy = true; let finish; settled = new Promise(resolve => { finish = resolve; });
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)]);
      let ref, token, terminal = false, submitting = false;
      const current = async () => { signal.throwIfAborted(); if (!isCurrent(request.game, request.match)) throw fail(409, '对局已切换'); if (await getToken() !== token) throw fail(401, '登录状态已切换'); };
      const progress = event => { try { onProgress({event, game: request.game, match: request.match, topic: request.topic, requestId: request.activityId}); } catch {} };
      try {
        token = await getToken(); if (typeof token !== 'string' || !/^jc_[a-f0-9]{64}$/.test(token)) throw fail(401, '请先用邮箱登录');
        if(archive&&archive.state!=='ready'&&token!==archive.token){monitor?.controller.abort();archive=null;}
        if(archive&&archive.state!=='ready'){
          const reason=archive.reason;
          if(monitor?.finished)watchArchive(request,archive.ref,archive.token,{archiveState:'attention',archiveReason:reason});
          throw fail(425,reason==='context_changed'?'对局或登录状态已变化，请确认后重新同步':'上一条对话正在保存，请稍后再试','archive_pending');
        }
        const binding = await getBinding(request); await current();
        if (!binding || binding.game !== request.game || binding.match !== request.match || !/^[a-f0-9-]{36}$/.test(binding.deviceId ?? '') || !/^[a-f0-9]{64}$/.test(binding.matchKey ?? '')) throw fail(425, '游戏数据尚未同步，请稍后重试', 'collector_not_ready');
        submitting = true;
        const role=request.role??'jinbao';if(!['jinbao','liurufeng','wangbatian','tiezhi'].includes(role))throw fail(400,'导师角色无效');
        const created = await call({action: 'submit', deviceId: binding.deviceId, matchKey: binding.matchKey, requestId: randomUUID(), text: request.question,role}, token, signal);
        if (!/^[a-f0-9]{32}$/.test(created.taskId ?? '') || !/^[a-f0-9]{64}$/.test(created.budgetId ?? '')) throw fail(502, 'Invalid task reference');
        ref = {taskId: created.taskId, budgetId: created.budgetId}; submitting = false;
        progress('task_waiting_node');
        let failures = 0;
        for (;;) {
          await current(); let result;
          try { result = await call({action: 'status', ...ref}, token, signal); failures = 0; }
          catch (error) { if (!signal.aborted && (!error.status || [429, 502, 503, 504].includes(error.status)) && failures++ < 2) { progress('connection_retry'); await sleep(Math.max(pollMs, 500), undefined, {signal}); continue; } throw error; }
          await current();
          if (result.taskId !== ref.taskId || result.budgetId !== ref.budgetId) throw fail(502, 'Task response mismatch');
          if (result.state === 'completed') {
            if (typeof result.text !== 'string' || !result.text.trim() || Buffer.byteLength(result.text) > 1024) throw fail(502, 'Empty task answer');
            terminal = true;watchArchive(request,ref,token,result);return result.text;
          }
          if (result.state === 'cancelled') { terminal = true; throw fail(409, '任务已取消'); }
          if (!['pending', 'claimed'].includes(result.state)) throw fail(502, 'Unknown task state');
          await sleep(pollMs, undefined, {signal});
        }
      } catch (error) {
        if (submitting && !ref && !error.notSubmitted && (!error.status || [502, 503, 504].includes(error.status))) uncertain = true;
        if (signal.aborted && !lifetime.signal.aborted) throw fail(504, '节点分析超时');
        throw error;
      } finally {
        if (ref && !terminal) {
          try { const result = await call({action: 'cancel', ...ref}, token, AbortSignal.timeout(5000)); if (result.taskId !== ref.taskId || result.budgetId !== ref.budgetId || !['completed', 'cancelled'].includes(result.state)) uncertain = true; }
          catch { uncertain = true; }
        }
        busy = false; finish();
      }
    },
    async close() { lifetime.abort(); await settled; await monitor?.task; }
  };
}

export function createNodeTaskPreviewRouter(node, legacy) {
  return {
    ask: request => request.topic === 'chat' && request.automatic !== true ? node.ask(request) : legacy.ask(request),
    async close(options) { const results = await Promise.allSettled([node.close(options), legacy.close(options)]); const failed = results.find(value => value.status === 'rejected'); if (failed) throw failed.reason; }
  };
}
