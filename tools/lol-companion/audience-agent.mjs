import {createHash} from 'node:crypto';
import {viewerReply} from './viewer-reply.mjs';

const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const names=(values,key='name')=>Array.isArray(values)?values.slice(0,12).map(x=>text(typeof x==='string'?x:x?.[key],60)).filter(Boolean):[];
export function publicAudienceContext(view={}){
 const live=view.liveStats??{},facts=view.viewerFacts??{};
 return {game:['lol','wzry','generic'].includes(view.game)?view.game:'generic',
  champion:text(live.champion??view.selfChampion,60),gameTime:text(view.gameTime,24),
  mode:text(view.mode,60),phase:text(view.phase,40),items:names(facts.items),augments:names(facts.augments),enemies:names(facts.enemies,'champion')};
}

// Composition-only adapter. Do not pass the player's existing cloud/local Agent.
// The server must enforce the audience namespace and tool scope independently.
export function createAudienceResponder({agent=null,now=Date.now,intervalMs=30000,timeoutMs=15000,maxPerHour=20}={}){
 if(agent!==null&&(agent.scope!=='public-audience-v1'||typeof agent.ask!=='function'))throw Error('audience_agent_scope_required');
 let epoch=0,room='',busy=false,last=-Infinity,windowAt=now(),used=0,closed=false,active=null,held=null,roomConfigured=false,configError='';
 const bind=next=>{if(room!==String(next)){room=String(next);epoch++;active?.abort();}};
 return {
  bind,
  status:()=>({configured:!!agent,roomConfigured,configError,busy,held:held!==null,used,maxPerHour,
   ...(agent?.status?{transport:agent.status()}:{} )}),
  async configureRoom(roomId){
   roomConfigured=false;configError='';
   if(typeof agent?.configureRoom!=='function')return {configured:false,reason:'audience_agent_unavailable'};
   try{const result=await agent.configureRoom(String(roomId??''));roomConfigured=result.configured===true&&result.bound===(roomId!=='');return {configured:roomConfigured};}
   catch{configError='room_binding_failed';return {configured:false,reason:configError};}
  },
  async recover(){
   if(closed||busy||held!==null||typeof agent?.recover!=='function')return {recovered:false};
   try{return await agent.recover();}catch{return {recovered:false};}
  },
  async reply(question,view={},role='jinbao'){
   const input=text(question,200).trim(),short=input.replace(/@?金宝/g,'').trim();
   const fallback=viewerReply(input,{champion:view.selfChampion,...view.viewerFacts},now());
   if(closed||!input)return null;
   if(/^(你好[呀啊哇]?|您好|嗨|哈喽|hello|hi|谢谢[你啦啊]?|感谢|多谢|thanks)[\s!！。~～]*$/i.test(short))return {text:fallback,source:'local'};
   if(!agent)return {text:fallback,source:'local',reason:'audience_agent_unavailable'};
   if(agent.status?.().roomBindingEnabled===true&&!roomConfigured)
    return {text:fallback,source:'local',reason:'audience_room_unverified'};
   if(now()-windowAt>=3600000){windowAt=now();used=0;}
   if(!room||busy||held!==null||now()-last<intervalMs||used>=maxPerHour)return {text:fallback,source:'local',reason:'audience_rate_limited'};
   const generation=epoch,match=text(view.match,160),controller=new AbortController();
   active=controller;busy=true;last=now();used++;
   let timer,abortHandler,settled=false;
   const stopped=new Promise((_,reject)=>{
    abortHandler=()=>reject(Error('audience_request_aborted'));
    controller.signal.addEventListener('abort',abortHandler,{once:true});
    timer=setTimeout(()=>controller.abort(),timeoutMs);
   });
   try{
    const sessionId='audience-'+createHash('sha256').update(JSON.stringify([room,view.game,match])).digest('hex');
    const execution=Promise.resolve().then(()=>{
     controller.signal.throwIfAborted();
     return agent.ask({sessionId,roomId:room,question:input,context:publicAudienceContext(view),
      role:['jinbao','liurufeng','wangbatian','tiezhi'].includes(role)?role:'jinbao',signal:controller.signal});
    }).finally(()=>{settled=true;if(held===controller)held=null;});
    const result=await Promise.race([execution,stopped]);
    if(closed||epoch!==generation||controller.signal.aborted)return null;
    if(typeof result?.text!=='string'||!result.text.trim()||result.text.length>180)throw Error('audience_reply_invalid');
    return {text:result.text.trim(),source:'agent'};
   }catch{
    if(closed||epoch!==generation)return null;
    return {text:fallback,source:'local',reason:'audience_agent_failed'};
   }finally{
    clearTimeout(timer);controller.signal.removeEventListener('abort',abortHandler);
    if(!settled)held=controller;
    controller.abort();if(active===controller)active=null;busy=false;
   }
  },
  close(){closed=true;epoch++;active?.abort();return agent?.close?.();},
 };
}
