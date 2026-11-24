import {readFile,mkdir,copyFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertReleaseRuntime} from '../desktop-release/runtime-policy.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Separate preview artifact: never changes stable release metadata or update feeds.
export async function buildPreview({root,out,runtime=process.execPath}) {
 const updateVersion='0.3.20',version=updateVersion+'-standalone-preview.1';
 const files=new Set();
 async function include(name) {
  const path=resolve(root,name),local=relative(root,path);
  if(local.startsWith('..')||local.startsWith(sep))throw Error('Asset outside project');
  if(files.has(local))return;
  files.add(local);
  if(!/\.(mjs|js)$/.test(local))return;
  const source=await readFile(path,'utf8');
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
   const spec=match[1];
   if(spec.startsWith('node:'))continue;
   if(!spec.startsWith('.'))throw Error('Standalone preview has an external dependency: '+spec);
   await include(relative(root,resolve(dirname(path),spec)));
  }
 }
 for(const name of ['tools/cloud-desktop/main.mjs','tools/cloud-desktop/experience-tools.mjs','tools/cloud-desktop/entry.mjs','tools/lol-companion/collector.mjs'])await include(name);
 for(const name of [
  'tools/cloud-desktop/protect.ps1','tools/cloud-desktop/instance.ps1','tools/cloud-desktop/audio-player.ps1','tools/cloud-desktop/synthesize-speech.ps1','tools/dsh-onboarding/settings.html',
  // First-run guide is read at runtime, so the module walk above cannot see it.
  'tools/dsh-onboarding/welcome.html',
  ...['advice','augments','players','settings','collapsed','overlay-settings','overlay-modes'].map(n=>'tools/dsh-onboarding/welcome/'+n+'.png'),
  ...['advice','settings','collapsed','overlay-settings','overlay-modes'].map(n=>'tools/dsh-onboarding/welcome/'+n+'.gif'),
  // The exploration page and its two assets were never packaged, so /exploration 404'd
  // in the standalone build even though the settings page links to it.
  'tools/dsh-onboarding/exploration.html','tools/dsh-onboarding/exploration-icon.png','tools/dsh-onboarding/exploration-poster.jpg',
  // 金宝日记是独立页面，同样由模块遍历看不到。
  'tools/dsh-onboarding/diary.html',
  // 探索图鉴改版后新增的运行时数据：本地探索服务用 readFileSync 读，模块遍历看不到它们。
  'tools/dsh-onboarding/exploration-aliases.json','tools/dsh-onboarding/exploration-catalog.json','tools/dsh-onboarding/lol-roster.json',
  // 悬浮窗头像与装备图标的数据文件：运行时读取，模块遍历看不到。
  'tools/dsh-onboarding/champion-aliases.json','tools/dsh-onboarding/item-icon-paths.json',
  ...(await readdir(resolve(root,'tools/dsh-onboarding/exploration-icons')).catch(()=>[]))
    .filter(name=>/\.(jpg|png)$/i.test(name))
    .map(name=>'tools/dsh-onboarding/exploration-icons/'+name),
  // 形象层：脚本 + 每个状态的帧序列（用户重画后只要按目录丢文件即可）
  'tools/desktop-release/overlay-pet.ps1',
  ...(await (async () => {
    const out = [];
    const petRoot = 'tools/desktop-release/assets/pet';
    let states = [];
    try { states = await readdir(resolve(root, petRoot)); } catch { return out; }
    for (const state of states) {
      let frames = [];
      try { frames = await readdir(resolve(root, petRoot, state, 'frames')); } catch { continue; }
      for (const frame of frames.filter(name => /\.png$/i.test(name))) out.push(petRoot + '/' + state + '/frames/' + frame);
    }
    // 单张立绘回退：只画了一张图时用这些文件
    for (const name of ['icon.png', 'avatar.png', 'icon.jpg', 'static.png', 'portrait.png', 'static.jpg', 'portrait.jpg']) {
      try { await stat(resolve(root, petRoot, name)); out.push(petRoot + '/' + name); } catch {}
    }
    return out;
  })()),
  'tools/team-room/page.html','tools/team-room/page.css','tools/team-room/page.mjs',
  'tools/dsh-coach-server/capture-game.ps1','tools/lol-companion/capture-augments.ps1','tools/lol-companion/augment-names.json',
// Spawned as its own process by the collector on every augment offer, so the
// module walk above cannot see it either. Without it the pick detector is dead.
'tools/lol-companion/card-watch.ps1',
  // Data read at runtime rather than imported, so the module walk above cannot see it.
  'tools/lol-companion/hextech-partners.json',
  'tools/lol-companion/AllyUltimateVision.cs','tools/lol-companion/observe-ally-ultimates.ps1',
  'tools/jinbao-launcher/platform.ps1','tools/jinbao-launcher/legacy-overlay.ps1','tools/jinbao-launcher/legacy-window.ps1',
  'tools/jinbao-launcher/update-public.pem','tools/jinbao-launcher/extract-update.ps1',
  'tools/jinbao-launcher/install-host.ps1',
  'tools/game-observation/windows/worker.ps1','tools/game-observation/windows/WindowCapture.cs',
  ...['start-overlay','strategy-overlay','confirmation-countdown','overlay-modes','overlay-ui','overlay-playback','overlay-categories','capture-coordination','window-pixels','agent-activity'].map(n=>'tools/desktop-release/'+n+'.ps1'),
  'LICENSE','third-party/node-LICENSE.txt','tools/cloud-desktop/Launcher.cs'
 ])await include(name);
 await mkdir(out); // Deliberately refuses to overwrite an existing artifact.
 for(const name of files){const target=join(out,name);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,name),target);}
 await mkdir(join(out,'runtime'));
 await copyFile(runtime,join(out,'runtime/node.exe'));
 await copyFile(join(root,'third-party/node-LICENSE.txt'),join(out,'runtime/LICENSE'));
 await writeFile(join(out,'package.json'),JSON.stringify({name:'jinbao-cloud-preview',private:true,type:'module',version}));
 const releaseNotes=await readFile(new URL('./release-notes.txt',import.meta.url),'utf8').catch(()=>'独立桌面版 '+updateVersion);
 await writeFile(join(out,'tools/dsh-onboarding/release-notes.json'),JSON.stringify({version:version+' (独立预览)',notes:releaseNotes.trim()}));
 const compiler=join(process.env.SystemRoot??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 await promisify(execFile)(compiler,['/nologo','/target:winexe','/optimize+','/reference:System.Windows.Forms.dll','/out:'+join(out,'jinbao.exe'),join(root,'tools/cloud-desktop/Launcher.cs')],{windowsHide:true});
 // Old signed-update verifiers require this filename. Keep only an inert
 // comment during migration; neither launcher nor CMD ever executes it.
 await writeFile(join(out,'start-preview.vbs'),'Rem Compatibility marker only. Start Jinbao.exe. No executable statements.\r\n');
 await writeFile(join(out,'开始使用.cmd'),'@echo off\r\nstart "" "%~dp0jinbao.exe"\r\n');
 await writeFile(join(out,'README.md'),[
  '# 金宝云端预览版','',
  '## 开始使用','',
  '1. 先退出其他金宝悬浮窗，将压缩包完整解压到新文件夹。',
  '2. 双击“开始使用.cmd”，悬浮窗和设置网页会自动打开。',
  '3. 官方服务默认自动尝试已开放的免登录体验名额；也可使用邮箱登录。进入游戏即可，无需安装 Node.js 或 DSH Desktop。',
  '4. 更新预览包时，确认退出旧窗口后，从新文件夹启动。登录保存在当前用户的 .jinbao-cloud-preview 目录中，同一 Windows 用户无需因换包重新登录（凭据有效时）。','',
  '## 悬浮窗操作','',
  '- 设置 → 直播展示：可开启智能体过程，仅在大框战况页显示；默认关闭。',
  '- 设置 → 显示与播报：大框、窄条、字幕、横向滚动或静默小球。',
  '- Ctrl+Alt+↑：展开；Ctrl+Alt+↓：收起并吸附右侧。',
  '- Ctrl+Alt+← / →：上一页 / 下一页。',
  '- 设置 → 快捷键：查看组合；若提示已被占用，可继续使用按钮操作。',
  '- 点击叉号后确认才退出，取消后继续运行。',
  '- 设置 → 显示与播报：可配置「鼠标穿透」，下方会显示聊天识别状态（聊天框未展开时会提示）。','',
  '## 页面','',
  '悬浮窗只有三页：**战况**（建议、关键事件时间线、聊天入口，以及开局与阵亡时的出装播报）、**海克斯**（三选一候选排名、本局已选、英雄 Top10 与推荐组合）、**胜率**（双方英雄样本胜率与团队估算）。','',
  '开局加载会给出六件完整出装顺序；每次阵亡会提醒下一次该补什么和原因。装备建议不再单独占一页。','',
  '## 通用游戏观察','',
  '设置 → 游戏与观察 → 其他电脑游戏：选择窗口并授权观察。已有日志也可从同页选择读取；本次多帧身份回写与自动分局主要适用于窗口看图路径。',
  '身份显示待核实、多帧印证或用户确认；已有看图结果会持续回写，不单独增加模型请求。游戏身份与模式不确定时不套用LoL规则。',
  '重复核实进入对局或结算时自动隔离会话；低频观察可能漏过快速结算，此时可点“当前窗口开始新一局”。旧日志保留，窗口继续观察，新局重新核实模式。身份不准可手动确认。当前并不保证任意游戏都能自动分局或给出正确策略。','',
  '## 角色与语音','',
  '在设置网页的“角色与语音”选择金宝、柳如风、王霸天或铁汁，并试听角色介绍。角色影响下一次战况和聊天的表达；语音播报默认关闭，可开启战况播报及聊天朗读。沿用旧版本已开启的语音开关。',
  '官方语音使用电脑的金宝登录；自有 DashScope 语音 Key 可独立配置并本机直连，语音 Key 独立于大模型 Key。四个角色使用与 App 相同的 CosyVoice 音色，不用 Windows 默认声音冒充。',
  '低频优先：自动分析任务（战况和后台出装共用）结束后至少冷却60秒，语音忙或待播时不发起自动分析。正常播报结束后至少安静45秒，每条最多60字、单段。自动建议不排队；手动聊天只留最新一条待播，20秒过期丢弃。长正文不另调模型摘要，无法提取完整短句就不播；完整文字保留。本地OCR与海克斯排名不受模型限频影响。用户主动提问不受自动任务额度限制，明确点击的角色试听可直接播放。','',
  '## 测试与诊断','',
  '每次启动自动记录本机诊断。设置网页 → 维护与诊断，可查看记录状态；发现异常时选择问题类型并点击“标记问题时间”，测试结束点击“导出诊断记录”。导出包含最近三次启动，不含聊天正文、玩家名、凭据或截图，不自动上传。诊断目录为当前用户 .jinbao-cloud-preview/diagnostics，最多保留10次启动，每次事件约2MB。异常标记只是排查线索，不代表游戏画面或建议质量已验收。','',
  '## 数据说明','',
  '胜率页顶部为随时间和击杀比分变化的局势估计；它未经结果校准，不是统计胜率。英雄表格仍显示资料库的样本胜率与强度。海克斯三选一按英雄适配排名展示，重掷经稳定识别后更新。','',
  '## 模型调用方式','',
  '默认使用金宝官方云端服务，无需安装 DSH Desktop。设置中可改为自己的 API Key：填写模型地址、模型名及密钥；需要本机安装 DSH Desktop，金宝会读取其原生 Agent 依赖到独立缓存，无需同时启动 DSH 窗口，不修改原 DSH 配置。自定义安装位置可填写程序路径。密钥按当前 Windows 用户加密保存，不发送给金宝服务器。攻略资料库检索仍需独立授权。','',
  '设置页支持检查、后台下载和安装独立桌面版更新，对局中不会安装。签名与文件校验失败时继续使用原版本，新版启动失败会回退。此包使用独立更新通道，不会安装旧版 DSH 插件包。','',
  '真实对局仍待验收。此包未正式发布，正式版继续使用原入口。',''
 ].join('\n'));
 const report={version,updateVersion,preview:true,runtime:'standalone',requiresDshDesktop:false,localModeRequiresInstalledDsh:true,bundledRuntime:true,externalPackages:0,adbIncluded:false,files:files.size+10};
 await writeFile(join(out,'preview-manifest.json'),JSON.stringify(report,null,2));
 // 快捷方式必须在生成清单之前做：这个脚本会往包里写 jinbao.ico，
 // 清单之后写就成了「多余文件」，更新校验 verifyPackage 会直接拒绝整包（0.2.37 踩过）。
 if(process.env.JINBAO_SKIP_SHORTCUT!=='1'){
  try{
   const result=await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'tools/cloud-desktop/update-shortcuts.ps1'),'-BuildDir',out],{windowsHide:true});
   if(result?.stdout?.trim())console.log(result.stdout.trim());
  }catch(error){console.error('shortcut update skipped: '+(error?.message??error));}
 }
 const manifest={version:updateVersion,runtime:'standalone',files:[]};
 async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await inventory(path);else{const bytes=await readFile(path);manifest.files.push({path:relative(out,path).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
 await inventory(out);await writeFile(join(out,'manifest.json'),JSON.stringify(manifest));
 return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 assertReleaseRuntime(process.version);
 if(process.platform!=='win32')throw Error('Windows preview build requires Windows');
 const root=fileURLToPath(new URL('../../',import.meta.url));
 if(!process.argv[2])throw Error('Supply a new output directory');
 const out=resolve(process.argv[2]);
 console.log(JSON.stringify(await buildPreview({root,out})));
}

