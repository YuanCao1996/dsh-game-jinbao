import {createHash} from 'node:crypto';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const rejected=()=>Object.assign(Error('collector_validation_failed'),{blocked:true});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const aliases={purchase:'purchase',augment_picked:'augment_picked',augment_picked_chat:'augment_picked',augment_offer:'augment_offered',augment_offered:'augment_offered',augment_refresh:'augment_refresh',tower:'tower',ace:'ace',match_start:'match_start',match_end:'match_end'};
const name=value=>{if(object(value))value=value.name;if((typeof value!=='string'&&!Number.isSafeInteger(value))||![...String(value)].length||[...String(value)].length>80)throw rejected();return String(value);};
function seconds(value){
 if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=86400)return Math.floor(value);
 if(typeof value==='string'&&/^\d{1,4}:[0-5]\d$/.test(value)){const [m,s]=value.split(':').map(Number);if(m*60+s<=86400)return m*60+s;}
 return -1;
}
export function normalizeCollectorRows(rows,archive){
 const events=[];let issues=0;
 for(const {row,offset} of rows){
  if(!Number.isSafeInteger(offset)||offset<0||offset>=2**43)throw rejected();
  let raw=row?.event??row;
  try{if(!object(raw))throw rejected();let details=raw.details??{};if(typeof details==='string')details=JSON.parse(details||'{}');if(!object(details))throw rejected();raw={...raw,...details};}catch{issues++;continue;}
  const children=raw.kind==='chat_events'?(raw.nestedEvents??raw.events):[raw];
  if(!Array.isArray(children)||children.length>64){issues++;continue;}
  for(let index=0;index<children.length;index++){
   const child=children[index];
   try{
    if(!object(child)||!Object.hasOwn(aliases,child.kind))throw rejected();
    const kind=aliases[child.kind],at=seconds(child.gameSeconds??child.gameTime??child.time??raw.gameSeconds??raw.gameTime??raw.state?.time??raw.time),details={};
    if(at===-1)details.time_status='unknown';if(child.champion!=null)details.champion=name(child.champion);
    if(kind==='purchase')details.item=name(child.item);
    if(kind==='augment_picked'){
     const status=child.selection_status??({'user-confirmed':'user_confirmed','countdown-default-confirmed':'default_confirmed',lcu:'observed'})[child.source];
     if(child.confidence==='low'||child.source==='ocr-inferred'||!['observed','user_confirmed','default_confirmed'].includes(status))throw rejected();
     details.augment=name(child.augment??child.name);details.selection_status=status;
    }
    if(['augment_offered','augment_refresh'].includes(kind)){const candidates=child.candidates??child.options;if(!Array.isArray(candidates)||candidates.length<1||candidates.length>6)throw rejected();details.augments=candidates.map(name);}
    if(Buffer.byteLength(canonical(details))>1024){issues++;continue;}
    events.push({id:sha(canonical([archive,offset,index])),sequence:offset*128+index,game_seconds:at,kind,details});
   }catch{issues++;}
  }
 }
 return {events,issues};
}
export function planCollectorUploads(archive,events){
 const result=[];let chunk=[];
 for(const event of events){
  if(chunk.length>=100||Buffer.byteLength(canonical({archive,events:[...chunk,event]}))>30000){if(!chunk.length)throw rejected();result.push({archive,events:chunk});chunk=[];}
  chunk.push(event);if(Buffer.byteLength(canonical({archive,events:chunk}))>30000)throw rejected();
 }
 if(chunk.length)result.push({archive,events:chunk});if(result.length>16)throw rejected();return result;
}
