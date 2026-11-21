import{createCloudCapture}from'./capture.mjs';
import{createCloudCoach}from'./auto-coach.mjs';
import{claimInstance}from'./instance.mjs';
import{createEventQuery}from'./event-query.mjs';
import{createRuntimeRouter}from'./runtime-router.mjs';
import{createLocalAgent}from'./local-agent.mjs';import{createExperienceToolkit,experienceCallback}from'./experience-tools.mjs';
import{locateNativeModules}from'./native-modules.mjs';
import{createWebSearch}from'./web-search.mjs';
import{createStandaloneUpdates}from'./updates.mjs';
import{createDiary}from'./diary.mjs';
import{createDiaryStore}from'../dsh-onboarding/diary-store.mjs';
import{readTeamFlag}from'../team-room/settings-flag.mjs';
import{preferredPort,readSavedPort}from'../shared/port-preference.mjs';
import{dayKey}from'../lol-companion/diary-day.mjs';
import{roleById}from'./roles.mjs';
import{createDesktopObservation}from'./observation.mjs';
import{createNativeInstaller}from'./native-installer.mjs';
import{access,rm,readFile,writeFile,appendFile,mkdir}from'node:fs/promises';
import{createExternalLogSource}from'./log-source.mjs';
import{createUserMemory}from'./user-memory.mjs';
import{createAgentActivity}from'../agent-activity/activity.mjs';
import{createShutdown,notifyRestart}from'./shutdown.mjs';
import{createOverlaySupervisor}from'./overlay-supervisor.mjs';
import{acquireInstanceLock,releaseInstanceLock,publishSettingsUrl}from'../shared/instance-lock.mjs';
import{createDiagnostics}from'./diagnostics.mjs';
import{createSpeech,cloudSpeech,ownSpeech}from'./speech.mjs';
import{createAutomaticPacing}from'./automatic-pacing.mjs';
import{createRoomCacheStore}from'../team-room/cache-store.mjs';
import{createCacheReportUploader}from'../team-room/cache-reports.mjs';
import{createHostUsageOutbox}from'../team-room/usage-outbox.mjs';
import{createSetupServer}from'../dsh-onboarding/server.mjs';import{createStorageMaintenance}from'../dsh-onboarding/storage-maintenance.mjs';import{createCredentials}from'./credentials.mjs';import{createCloudAgent}from'./cloud-agent.mjs';import{createGameMemory}from'../dsh-coach-server/lib/game-memory.js';
import{createSupervisor}from'../jinbao-launcher/supervisor.mjs';import{createAgentStatus}from'../dsh-coach-server/lib/agent-status.js';
import{resolve,join}from'node:path';import{homedir}from'node:os';import{fileURLToPath}from'node:url';import{execFile}from'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));const args=process.argv.slice(2);
const stateDir=resolve(args.includes('--state')?args[args.indexOf('--state')+1]:join(homedir(),'.jinbao-cloud-preview'));
const storage=createStorageMaintenance({stateDir,launcherPath:join(root,'jinbao.exe')});
const portArg=args.includes('--port')?Number(args[args.indexOf('--port')+1]):null;
const port=preferredPort({arg:portArg,saved:await readSavedPort(stateDir)});
const instance=await claimInstance(stateDir);
if(!instance.owned){
 if(!args.includes('--headless')){
  try{const link=(await readFile(join(stateDir,'settings-link.txt'),'utf8')).trim();if(/^http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]{64}$/.test(link))execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tools/jinbao-launcher/platform.ps1'),'-Action','open','-Target',link],{windowsHide:true},()=>{});}catch{}
  execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tools/desktop-release/start-overlay.ps1'),'-StateDir',stateDir],{windowsHide:true},()=>{});
 }
 await instance.close();console.log(JSON.stringify({alreadyRunning:true}));
}else{
let teamCacheStore=null,cacheDiagnostics=null;const cacheEvents=[];
const cacheTrace=value=>{const action=({team_cache_content_deleted:'cache_deleted',team_cache_report_received:'cache_report_received',team_cache_report_pending:'cache_report_pending',team_usage_report_received:'usage_report_received',team_usage_report_pending:'usage_report_pending'})[value.event]??'cache_cleanup_pending';const event=value.event.startsWith('team_usage_')?'usage':'cache';if(cacheDiagnostics)cacheDiagnostics.record(event,{action});else if(cacheEvents.length<20)cacheEvents.push({event,action});};
try{teamCacheStore=await createRoomCacheStore({stateDir,trace:cacheTrace});}catch{cacheTrace({event:'team_cache_cleanup_pending'});}
const credentials=await createCredentials(stateDir),memory=createGameMemory(stateDir);let setup;
let teamCacheReports=null;try{if(teamCacheStore)teamCacheReports=await createCacheReportUploader({credentials,cacheStore:teamCacheStore,trace:cacheTrace});}catch{cacheTrace({event:'team_cache_report_pending'});}
let teamUsageOutbox=null;try{teamUsageOutbox=await createHostUsageOutbox({credentials,trace:cacheTrace});}catch{cacheTrace({event:'team_usage_report_pending'});}
const observation=createDesktopObservation({stateDir,trace:value=>diagnostics.record('observation',value),view:()=>setup?.view()??{}});
const nativeInstaller=createNativeInstaller({root,stateDir});
const logSource=await createExternalLogSource({stateDir,publish:event=>appendFile(join(stateDir,'logs/external-live.jsonl'),JSON.stringify(event)+'\n',{mode:0o600})});
const context=(game,match)=>memory.currentFacts(game,match),queryEvents=createEventQuery(memory),specializedCapture=createCloudCapture({stateDir,readState:()=>setup?.view()}),capture=async request=>{const started=Date.now();try{const frame=await(request.game==='generic'?observation.capture(request):specializedCapture(request));diagnostics.record('capture',{game:request.game,match:request.match,available:!!frame,elapsedMs:Date.now()-started,ageMs:frame?.captured_at_ms?Date.now()-frame.captured_at_ms:undefined});return frame;}catch(error){diagnostics.record('capture',{game:request.game,match:request.match,available:false,reason:'capture_failed',elapsedMs:Date.now()-started});throw error;}};
const isCurrent=(game,match)=>{if(game==='generic'&&observation.status().enabled&&observation.status().match!==match)return false;const v=setup?.view();return (v?.game||'lol')===game&&(v?.match||'waiting')===match;};
const userMemory=createUserMemory({stateDir,memory,isCurrent});
const activity=await createAgentActivity({stateDir,getView:()=>setup?.view()});
const diagnostics=await createDiagnostics({stateDir,view:()=>setup?.view()??{},expectOverlay:!args.includes('--headless')});
cacheDiagnostics=diagnostics;for(const {event,action} of cacheEvents)diagnostics.record(event,{action});cacheEvents.length=0;
const officialSpeech=cloudSpeech({getToken:async()=>(await credentials.resolve('JINBAO_SERVICE_TOKEN'))?.value}),byokSpeech=ownSpeech({getKey:async()=>(await credentials.resolve('JINBAO_USER_SPEECH_API_KEY'))?.value});
const speech=await createSpeech({stateDir,view:()=>setup?.view()??{},synthesize:(text,role,signal,source)=>(source==='byok'?byokSpeech:officialSpeech)(text,role,signal),trace:event=>diagnostics.record('speech',{game:setup?.view().game,match:setup?.view().match,...event})});
const pacing=createAutomaticPacing({busy:()=>rawAgent.busy()||!speech.canAutoRequest(),onSkip:request=>diagnostics.record('coach',{game:request.game,match:request.match,action:'skip',reason:'output_backpressure'})});
// 失败原因的玩家可见说法：只有让玩家看懂是「服务端故障」还是「登录失效」，
// 才知道该重发一次还是该去设置页重新登录。
const FAIL_REASON={
 service_unavailable:'服务暂时不可用，稍后再发一次',
 upstream_timeout:'云端响应超时，稍后再发一次',
 upstream_error:'云端返回异常，稍后再发一次',
 rate_limited:'请求太频繁，等几秒再发',
 login_required:'登录状态失效，请在设置页重新登录',
 match_changed:'对局已切换',
 agent_preempted:'已优先处理你的提问',
 other:'原因未知，可导出诊断记录反馈',
};
const onProgress=event=>{diagnostics.accept(event);activity.accept(event); // 任务失败时把错误码也带给动态面板，便于区分超时/限流/模型错误。
 if(event.event==='task_failed')activity.accept({...event,label:'分析失败('+(FAIL_REASON[event.code]||event.code||event.error||'未知')+')'});
if(['generic_observation','public_text','budget_check','model_reserved','model_permission'].includes(event.event))return;return createAgentStatus(stateDir,event.game,event.match)(['completed','task_completed','task_cancelled','task_stale'].includes(event.event)?'complete':event.event==='task_failed'?'error':event.event==='tool_start'?'tool':'start',event.name);};
// 私有经验：云端 agent 通过回调在本机读写，数据不出本机（与 BYOK 同一套语义）。
const experienceToolkit=createExperienceToolkit({dir:stateDir,player:String(process.env.JINBAO_PLAYER_ID||'local')});
const experienceTools=experienceCallback(experienceToolkit);
const rawAgent=createRuntimeRouter({getMode:()=>setup?.config().mode??'cloud',isCurrent,onEvent:onProgress,factories:{
 cloud:()=>createCloudAgent({getActivityEnabled:activity.isEnabled,apiPrefix:'/desktop/agent-preview',deviceId:stateDir,getToken:async()=>(await credentials.resolve('JINBAO_SERVICE_TOKEN'))?.value,getContext:context,queryEvents,isCurrent,capture,onObservation:value=>observation.feedback(value),experienceTools,onProgress,memoryTools:userMemory.execute,observationPlan:args=>observation.plan(args)}),
 byok:()=>createLocalAgent({stateDir,getConfig:()=>setup.config(),getKey:async()=>(await credentials.resolve('JINBAO_USER_MODEL_API_KEY'))?.value,getContext:context,queryEvents,isCurrent,capture,onObservation:value=>observation.feedback(value),onProgress,getActivityEnabled:activity.isEnabled,memoryTools:userMemory.execute,search:query=>setup.search(query),webSearch:createWebSearch(),observationPlan:args=>observation.plan(args)}),
}});
// 日记：一天最多一篇，只在没有进行中的对局时写；写不成就是这天没写，不留占位。
const diaryIdle=()=>{const v=setup?.view();if(!v)return true;return !(v.match&&!v.ended&&(v.gameTime!=='等待对局'||v.phase==='ChampSelect')&&Date.now()-(v.updatedAt??0)<30000);};
// 每周一次「网上在传什么」：B 站热榜原文，本地只挑梗（见 diary-trends.mjs）。失败就当这周没有。
const trendSource=async()=>{
 const texts=[],get=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'}});if(!response.ok)throw Error('trend fetch failed');return await response.json();};
 try{const data=await get('https://api.bilibili.com/x/web-interface/search/square?limit=50');for(const item of data?.data?.trending?.list??[])if(typeof item?.keyword==='string')texts.push(item.keyword);}catch{}
 try{const data=await get('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all');for(const item of data?.data?.list??[])if(typeof item?.title==='string')texts.push(item.title);}catch{}
 return texts;
};
const diary=createDiary({store:createDiaryStore({stateDir}),stateDir,query:queryEvents,trendSource,
 ask:async question=>{if(!diaryIdle())throw Object.assign(Error('Match active'),{status:409});const v=setup?.view();return rawAgent.ask({game:v?.game||'lol',match:v?.match||'waiting',question,topic:'chat',automatic:false,role:speech.role()});},
 role:()=>roleById(speech.role()).name,isIdle:diaryIdle,trace:event=>diagnostics.record('diary',event)});
// 「他主动找她聊过几次」：日记的分数要用，所以只记一个计数，不存内容。
const countDiaryQuestion=async()=>{try{await mkdir(join(stateDir,'diary'),{recursive:true});await appendFile(join(stateDir,'diary','questions-'+dayKey(Date.now())+'.jsonl'),JSON.stringify({at:Date.now()})+'\n',{mode:0o600});}catch{}};
const agent={...rawAgent,ask:request=>pacing.run(request,async admitted=>{if(admitted.topic==='chat')void countDiaryQuestion();const role=speech.role(),answer=await rawAgent.ask({...admitted,role});if(role!==speech.role())throw Object.assign(Error('Role changed'),{status:409,code:'agent_preempted'});if(admitted.topic==='chat')speech.chat({...admitted,text:answer});return answer;})};
let restartRequested=false;
const updates=createStandaloneUpdates({root,stateDir,restart:process.connected?async()=>{await writeFile(join(stateDir,'overlay-control.json'),JSON.stringify({action:'exit',at:Date.now()}));restartRequested=true;setTimeout(()=>void stop(),500);}:null});
// 测试功能开关：命令行参数优先（测试用），其次看设置页写的 team-rooms.json，下次启动生效。
const teamFlag=await readTeamFlag(stateDir).catch(()=>({enabled:false,byokHost:false}));
const teamRoomsEnabled=args.includes('--team-rooms')||teamFlag.enabled;
const teamByokEnabled=args.includes('--team-byok-host')||teamFlag.byokHost;
setup=await createSetupServer({credentials,stateDir,port,storage,cloudAgent:agent,localAgent:agent,runtimeId:'standalone',teamRooms:teamRoomsEnabled,teamHostPreview:teamByokEnabled&&!!teamCacheStore&&!!teamCacheReports&&!!teamUsageOutbox,teamCacheStore,teamCacheReports,teamUsageOutbox,teamUsageError:!teamUsageOutbox,teamCacheError:!teamCacheStore||!teamCacheReports,activity,diagnostics,speech,canAutoRequest:pacing.canRequest,prepareModel:async config=>{if(config.mode==='byok')try{await locateNativeModules({stateDir,desktopPath:config.desktopPath});const validation=await createLocalAgent({stateDir,getConfig:()=>config,getKey:async()=>'',getContext:async()=>({})});await validation.close();}catch{throw Object.assign(Error('Local DSH unavailable'),{status:409,code:'local_dsh_unavailable'});}},onModelChange:()=>agent.reconfigure(),updateController:updates,observation,nativeInstaller,logSource,userMemory,diary});
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version+' (独立预览)';
// Reuse the server's existing IP-based trial seats. A remembered login or an
// explicit local-mode choice always wins; exhausted seats fall back to email UI.
const loginTask=!args.includes('--headless')?setup.ensureTrialLogin().catch(()=>{}):Promise.resolve();
await writeFile(join(stateDir,'launcher-state.json'),JSON.stringify({phase:'cloud-preview',version,updatedAt:Date.now()}));

// 磁盘维护：启动后 30 秒跑一次，之后每天一次（只删过期/可再生数据）。
const storageSweep=()=>storage.cleanup('all').then(result=>{if(result.freedBytes>0)console.log(JSON.stringify({event:'storage_cleanup',freedBytes:result.freedBytes}));}).catch(()=>{});
setTimeout(storageSweep,30000).unref?.();
setInterval(storageSweep,24*60*60*1000).unref?.();
const heartbeat=setInterval(()=>void writeFile(join(stateDir,'launcher-state.json'),JSON.stringify({phase:'standalone',version,updatedAt:Date.now()})).catch(()=>{}),5000);
const updateTimer=setInterval(()=>void updates.check(),6*60*60*1000);void updates.check();
const diaryTimer=setInterval(()=>void diary.tick(),10*60*1000);setTimeout(()=>void diary.tick(),45000).unref?.();
const speechTimer=setInterval(()=>speech.tick(),500);
const diagnosticsTimer=setInterval(()=>void diagnostics.tick(),2000);
const observationTimer=setInterval(()=>{void observation.tick();void logSource.tick();},500);
// 独立版与插件版共享一把 UI 所有权锁：先启动的一方拥有悬浮窗与语音，后来者降级。
// 端口其实不冲突（本进程的设置端口是随机的，教练也在进程内），冲突的是"谁在屏幕上说话"。
const instanceLock=acquireInstanceLock({line:'standalone',stateDir});
const secondaryLock=instanceLock.role==='secondary';
if(instanceLock.role==='owner')publishSettingsUrl(setup.url);
if(secondaryLock)try{await writeFile(join(stateDir,'instance-secondary.json'),JSON.stringify({owner:instanceLock.owner?.line??'unknown',settingsUrl:instanceLock.owner?.settingsUrl??'',at:Date.now()}),{mode:0o600});}catch{}
await rm(join(stateDir,'overlay-stopped'),{force:true});
const coach=args.includes('--coach')&&!secondaryLock?createCloudCoach({stateDir,canRequest:pacing.canRequest,trace:diagnostics.coach,view:setup.view,getContext:(game,match)=>memory.currentFacts(game,match),agent,diaryLine:()=>diary.threadForPrompt(),absenceTone:()=>diary.currentTone(),enabled:()=>setup.config().mode!=='demo'}):null;
const coachTimer=coach?setInterval(()=>void coach.tick(),3000):null;
const supervisor=args.includes('--collect')?createSupervisor({root,stateDir}):null;
const interval=supervisor?setInterval(()=>void supervisor.tick().catch(()=>{}),3000):null;
const overlay=args.includes('--headless')?null:createOverlaySupervisor({stateDir,launch:recover=>new Promise((resolve,reject)=>{
 execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tools/desktop-release/start-overlay.ps1'),'-StateDir',stateDir,...(recover?['-Recover']:[])],{windowsHide:true},(error,stdout)=>error?reject(error):resolve({external:stdout.includes('Existing DSH Jinbao overlay restored.')}));
})});
const overlayTimer=overlay?setInterval(()=>void overlay.tick(),3000):null;
if(!args.includes('--headless')&&!secondaryLock){
 void overlay.start();
 execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tools/jinbao-launcher/platform.ps1'),'-Action','open','-Target',setup.url],{windowsHide:true},()=>{});
}
console.log(JSON.stringify({standalone:true,requiresDshDesktop:false,stateDir,port:setup.port,collecting:!!supervisor}));
if(process.connected)process.send({action:'ready'});
const stop=createShutdown({
 quiesce:()=>{if(interval)clearInterval(interval);if(coachTimer)clearInterval(coachTimer);if(overlayTimer)clearInterval(overlayTimer);void overlay?.close();clearInterval(stopTimer);clearInterval(heartbeat);clearInterval(diagnosticsTimer);clearInterval(speechTimer);clearInterval(diaryTimer);clearInterval(updateTimer);clearInterval(observationTimer);setup.stopAccepting();},
 steps:[['overlay',()=>overlay?.close()],['coach',()=>coach?.close()],['speech',()=>speech.close()],['agent',()=>agent.close()],['memory',()=>userMemory.close()],['collectors',()=>supervisor?.close()],['updates',()=>updates.close()],['observation',()=>observation.close()],['logs',()=>logSource.close()],['installer',()=>nativeInstaller.close()],['login',()=>loginTask],['settings',()=>setup.close()],['usage-outbox',()=>teamUsageOutbox?.close()],['cache-reports',()=>teamCacheReports?.close()],['team-cache',()=>teamCacheStore?.close()],['activity',()=>activity.close()],['diagnostics',()=>diagnostics.close()],['instance-lock',()=>releaseInstanceLock()],['instance',()=>instance.close()]],
 complete:async({failed})=>{try{await writeFile(join(stateDir,'shutdown-state.json'),JSON.stringify({at:Date.now(),state:failed.length?'completed_with_errors':'completed',failedSteps:failed}),{mode:0o600});await notifyRestart({requested:restartRequested,failed,connected:process.connected,send:(...values)=>process.send(...values)});}finally{process.exit(failed.length?1:0);}}
});
const stopTimer=setInterval(()=>void access(join(stateDir,'overlay-stopped')).then(stop).catch(()=>{}),500);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
if(process.connected){process.once('disconnect',stop);process.on('message',message=>{if(message?.action==='stop')void stop();});}
}
