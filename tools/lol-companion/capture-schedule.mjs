// Chooses between the cheap card-title pass and the expensive full-frame OCR.
//
// A real match showed the capture loop spending ~1.2s per cycle with almost every cycle a
// full-frame OCR, because the old rule ran a full frame on *every* capture whenever no
// panel was on screen. Titles-only reads are enough to notice a panel appearing, and the
// full pass only re-calibrates geometry, so both states now share one gate.
export function createCaptureSchedule({now=Date.now,fullIntervalMs=2000}={}){
 let nextFull=0,hotUntil=0;
 return {
  reset(){nextFull=0;hotUntil=0;},
  // ARAM 里三选一天然跟在阵亡之后（不是每次都有）。阵亡后开一段重点窗口，期间只跑便宜的
  // 标题帧，让面板出现的发现时间从 1–2 秒降到几百毫秒；窗口外节奏不变。
  boost(ms=25000){hotUntil=now()+Math.max(1000,ms);},
  hot(){return now()<hotUntil;},
  choose(){
   const at=now();
   if(at<hotUntil)return 'titles';
   if(at<nextFull)return 'titles';
   nextFull=at+fullIntervalMs;
   return 'full';
  }};
}
