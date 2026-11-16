// 云端补识别的"采纳门槛"。
//
// 只做两件事：
// 1) 只在本地已经不确定、且截图还新鲜时，才去读磁盘上的侧车图（capture-augments.ps1 写出的
//    vision-strip.jpg / vision-chat.jpg），避免拿旧画面去纠正新面板；
// 2) 模型结果必须吸附到已知名录（卡名）或至少给出可解析的行（聊天），否则一律不采纳。
//
// 这里不碰网络、不碰计时器，纯逻辑，方便单测。
import { readFile, stat } from 'node:fs/promises';
import { snapAugmentName } from '../shared/vision-assist.mjs';

export function createVisionVerify({
  assist,
  catalogue = [],
  now = Date.now,
  freshnessMs = 2500,
  readFileImpl = readFile,
  statImpl = stat,
  log = () => {},
} = {}) {
  const done = new Set();

  async function freshImage(path) {
    try {
      const info = await statImpl(path);
      if (!Number.isFinite(info?.mtimeMs) || now() - info.mtimeMs > freshnessMs) return null;
      const data = await readFileImpl(path);
      return data?.byteLength ? data : null;
    } catch { return null; }
  }

  return {
    /**
     * 纠正一轮三选一的卡名。返回 { names, previous, options, ms, model } 或 null。
     * 同一轮只尝试一次：模型读不出来时不要反复花钱。
     */
    async correctOffer({ roll, options = [], stateDir, matchId } = {}) {
      if (!assist || !stateDir) return null;
      const key = String(roll ?? '');
      if (!key) return null;
      if (done.has(key)) return null;
      done.add(key);
      if (done.size > 32) done.delete(done.values().next().value);
      const data = await freshImage(`${stateDir}/vision-strip.jpg`);
      if (!data) { log({ event: 'vision_verify', kind: 'augment', status: 'skipped', reason: 'stale_frame' }); return null; }
      const result = await assist.readTitles({ image: { data, mimeType: 'image/jpeg' }, matchId });
      if (!result?.list) return null;
      const names = result.list.map((value) => (value ? snapAugmentName(value, catalogue)?.name ?? null : null));
      if (names.filter(Boolean).length < 2) {
        log({ event: 'vision_verify', kind: 'augment', status: 'rejected', names });
        return null;
      }
      const previous = options.map((option) => option?.name ?? null);
      if (!names.some((name, index) => name && name !== previous[index])) return null;
      const merged = options.length
        ? options.map((option, index) => ({ ...(option ?? {}), slot: option?.slot ?? index, name: names[index] ?? option?.name ?? null }))
        : names.map((name, index) => ({ name, slot: index }));
      return { names, previous, options: merged, ms: result.ms, model: result.model };
    },

    /** 补读聊天行；返回模型给出的非空行。 */
    async readChat({ stateDir, matchId } = {}) {
      if (!assist || !stateDir) return null;
      const data = await freshImage(`${stateDir}/vision-chat.jpg`);
      if (!data) return null;
      const result = await assist.readChat({ image: { data, mimeType: 'image/jpeg' }, matchId });
      if (!result?.list) return null;
      const lines = result.list.filter((line) => typeof line === 'string' && line.trim());
      if (!lines.length) return null;
      return { lines, ms: result.ms, model: result.model };
    },
  };
}
