// Explicit opt-in adapter. The normal desktop route never constructs this.
import {createCollectorPreview} from './collector-preview.mjs';
import {createNodeTaskAgent,createNodeTaskPreviewRouter} from './node-task-agent.mjs';

export function createNodePreviewRuntime({enabled=false,stateDir,getView,getMode,getToken,isCurrent,onProgress,
  collectorFactory=createCollectorPreview,nodeFactory=createNodeTaskAgent}={}){
 if(!enabled)return null;
 const collector=collectorFactory({enabled:true,stateDir,getView,getMode,getToken});
 return {
  tick:()=>collector.tick(),
  status:()=>collector.status(),
  wrap(legacy){
   const node=nodeFactory({enabled:true,getToken,isCurrent,onProgress,getBinding:r=>collector.binding(r.game,r.match)});
   return createNodeTaskPreviewRouter(node,legacy);
  },
  close:()=>collector.close()
 };
}
