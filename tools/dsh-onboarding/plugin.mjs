import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createSetupServer } from './server.mjs';
import { createOverlayLauncher } from './overlay-launcher.mjs';
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const name='jinbao-onboarding';
export const inject=['credentials','tools','systemPrompt'];
export const Config=z.object({port:z.number().default(3084),coachPort:z.number().default(3081),stateDir:z.string().default(join(homedir(),'.dsh','jinbao')),serviceBaseUrl:z.string().default('https://api.jinbaoai.top'),
 // 悬浮窗：插件线默认自己拉起（安装器会把 desktop-release 与 jinbao-launcher 放进 profiles 同级）。
 overlay:z.boolean().default(true),overlayRoot:z.string().default(''),overlayLog:z.string().default('')});
// 装工具/改路径时如果发现悬浮窗没起来，先看这两个日志：
//   <stateDir>/overlay-plugin.log（本插件记的启动/退出/跳过原因）
//   <stateDir>/overlay-diagnostics/*.log（悬浮窗自己的 stdout/stderr）
function createLogger(stateDir,custom){
 const file=custom||join(stateDir,'overlay-plugin.log');
 return (entry)=>{
  try{appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...entry})+'\n');}catch{}
 };
}
export async function apply(ctx,cfg) {
 const setup=await createSetupServer({...cfg,credentials:ctx.credentials});
 ctx.effect(()=>()=>setup.close());
  ctx.tools.register(defineTool({name:'jinbao_settings',description:'Return local game-agent settings link; share only with the local user.',parameters:{},isConcurrencySafe:()=>true,output:{schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>({url:setup.url})}));
  ctx.systemPrompt.section({name:'jinbao:setup',order:114,text:'Use jinbao_settings for login, model configuration and log diagnostics. Never put credentials in messages or tool arguments.'});
 // 默认 overlayRoot 指向安装器放好的同级 desktop-release（本文件在 <profiles>/node_modules/dsh-onboarding/）
 if(cfg.overlay){
  const root=cfg.overlayRoot||join(dirname(fileURLToPath(import.meta.url)),'..','desktop-release');
  const launcher=createOverlayLauncher({stateDir:cfg.stateDir,scriptRoot:root,onLog:createLogger(cfg.stateDir,cfg.overlayLog)});
  if(launcher.start())ctx.effect(()=>()=>launcher.stop());
 }
}
