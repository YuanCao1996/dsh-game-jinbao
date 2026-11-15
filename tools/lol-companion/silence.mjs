// 采集静默判定：LCU 正常时每秒都有新数据；一旦客户端崩溃、断连或退到后台不动，
// 对局日志就停止增长。过去悬浮窗会一直挂着上一局的时钟（实测停在 08:19 十几分钟），
// 教练侧只有「2 分钟不改事实就不播报」的兜底，界面上没有「本局已结束」。
// 这里给采集器一个明确的结束信号，并且只标结束、不上报胜负。

export const SILENCE_END_MS = 120000;

/** 静默时长是否已经该判本局结束。 */
export function shouldEndOnSilence({ now, lastDataAt, threshold = SILENCE_END_MS, ended = false } = {}) {
  if (ended) return false;
  if (!Number.isFinite(now) || !Number.isFinite(lastDataAt) || lastDataAt <= 0) return false;
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return now - lastDataAt >= threshold;
}

/**
 * 静默结束要补进日志的事件。
 * 只发 phase 结束标记：悬浮窗会据此收尾，且因为没有 Result 字段，播报走「中性结束语」而不是判输。
 */
export function silenceEndEvents({ silentForMs = null, gameTime = null } = {}) {
  return [{ kind: 'phase', phase: 'EndOfGame', reason: 'collector_silence', silentForMs, gameTime }];
}
