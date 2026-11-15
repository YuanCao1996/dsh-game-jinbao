// 对局边界判定：什么时候算「新的一局」。
//
// 实测事故（2026-11-15 20:32）：一局打到 13:48 时 LCU 读数瞬断，`gameTime` 被打回 0（随后报到 3），
// 采集器把它当成「时钟回退 = 新对局」，于是另开了一个 live 日志。同一局被拆成两个 match：
// 出装/海克斯状态和播报冷却全部重置，前半局的「本局已选」也丢了。

/**
 * 时钟低到不可能（读数瞬断）。
 * 一局已经打到 previous 秒，突然报 60 秒以下，只可能是读表失败，不是真的重新开局。
 */
export function clockGlitch(time, previous) {
  if (!Number.isFinite(time) || !Number.isFinite(previous)) return false;
  return time < 60 && previous > 180;
}

/**
 * 是否该开新的一局。
 *
 * 判定顺序很重要：
 * 1. 显式标记（结算/换局）→ 新局
 * 2. 没有基线 → 新局
 * 3. 断流超过 30 秒后重新开始 → 新局（真重开一定伴随空窗）
 * 4. 时钟低于 60 秒但上一拍已过 3 分钟 → 读数瞬断，不是新局
 * 5. 时钟前进 → 不是新局
 * 6. 时钟回退超过 90 秒 → 新局
 */
export function startsNewMatch({ time, previous, nextMatch = false, sinceLastDataMs = 0, idleMs = 30000, dropToleranceSec = 90 } = {}) {
  if (nextMatch) return true;
  if (!Number.isFinite(previous)) return true;
  if (!Number.isFinite(time)) return false;
  if (sinceLastDataMs > idleMs) return true;
  if (clockGlitch(time, previous)) return false;
  if (time >= previous) return false;
  return previous - time > dropToleranceSec;
}
