// 一轮海克斯面板对应一个 card-watch 目录。写 meta 时要选对目录：
// 以前会把同一份 meta 写进所有「最近」的目录，日志里就看起来像同一轮起了两个 watcher。
// 选法：时间戳离本轮开始时间最近的那个（目录名是面板出现后几毫秒生成的）。
export function pickCardWatchDir(names, startedAt) {
  const candidates = names
    .filter(name => typeof name === 'string' && name.startsWith('card-watch-'))
    .map(name => { const stamp = Number(String(name.slice(11)).split('-')[0]); return { name, stamp }; })
    .filter(item => Number.isFinite(item.stamp) && Math.abs(item.stamp - startedAt) <= 5000)
    .sort((a, b) => Math.abs(a.stamp - startedAt) - Math.abs(b.stamp - startedAt));
  return candidates.length ? candidates[0].name : null;
}
