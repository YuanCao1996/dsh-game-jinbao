// B 站直播弹幕接入（主播模式）。
//
// 为什么不用官方 open-live：那条路要开发者资质 + 应用凭证，用户现在没有。
// 这里走的是**网页版读者连接**：取直播间弹幕服务器信息 → 连 WS → 收帧。
// 读到的是直播间公开弹幕，不涉及账号隐私，也不需要主播授权。
//
// 协议要点：
//  - HTTP: 房间号 → 真实房间号（room_init）；getDanmuInfo 需要 WBI 签名（2024 起）
//  - WS: 16 字节头（总长/头长/协议版本/操作码/序号）+ body
//    op 7 认证、op 2 心跳、op 5 通知、op 8 认证回复
//    protover 0/1 = JSON 或人气值，2 = zlib 压缩的多个帧，3 = brotli
//  - 弹幕在 cmd=DANMU_MSG 的 info 里；醒目留言在 SUPER_CHAT_MESSAGE

import { inflateRawSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const MIXIN_KEY_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const WEB_LOCATION = 444.8;
// 真机探测：缺少 UA / referer 时 getDanmuInfo 会返回 -352（WBI 校验不过）。
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  referer: 'https://live.bilibili.com/',
};
export const OP = Object.freeze({ HEARTBEAT: 2, HEARTBEAT_REPLY: 3, MESSAGE: 5, AUTH: 7, AUTH_REPLY: 8 });

// 16 字节头打包
export function packFrame(operation, body = '', version = 1) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const header = Buffer.alloc(16);
  header.writeUInt32BE(payload.length + 16, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(version, 6);
  header.writeUInt32BE(operation, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, payload]);
}

// 把一个 WS 收到的 Buffer 拆成若干逻辑帧（处理压缩包）
export function parseFrames(input) {
  const frames = [];
  const walk = buffer => {
    let offset = 0;
    while (offset + 16 <= buffer.length) {
      const total = buffer.readUInt32BE(offset);
      if (total < 16 || offset + total > buffer.length) break;
      const headerLen = buffer.readUInt16BE(offset + 4);
      const version = buffer.readUInt16BE(offset + 6);
      const operation = buffer.readUInt32BE(offset + 8);
      const body = buffer.subarray(offset + headerLen, offset + total);
      offset += total;
      if (operation === OP.MESSAGE && version === 2) {
        try { walk(inflateSync(body)); } catch { /* 坏包跳过 */ }
      } else if (operation === OP.MESSAGE && version === 3) {
        try { walk(brotliDecompressSync(body)); } catch { /* 坏包跳过 */ }
      } else if (operation === OP.MESSAGE && version === 0) {
        frames.push({ operation, version, text: body.toString('utf8') });
      } else if (operation === OP.HEARTBEAT_REPLY) {
        frames.push({ operation, version, popularity: body.length >= 4 ? body.readUInt32BE(0) : null });
      } else {
        frames.push({ operation, version, text: body.toString('utf8') });
      }
    }
    return frames;
  };
  return walk(Buffer.from(input));
}

// 把一条弹幕通知转成统一结构；不是弹幕就返回 null
export function parseDanmaku(text) {
  let packet;
  try { packet = JSON.parse(text); } catch { return null; }
  const cmd = String(packet?.cmd ?? '');
  if (cmd.startsWith('DANMU_MSG')) {
    const info = packet.info ?? [];
    const body = String(info?.[1] ?? '').trim();
    const user = String(info?.[2]?.[1] ?? '').trim();
    const uid = Number(info?.[2]?.[0]) || null;
    if (!body) return null;
    return { kind: 'viewer_message', platform: 'bilibili', user: user || '观众', uid, text: body, superChat: false, price: 0 };
  }
  if (cmd.startsWith('SUPER_CHAT_MESSAGE')) {
    const data = packet.data ?? {};
    const body = String(data.message ?? '').trim();
    if (!body) return null;
    return {
      kind: 'viewer_message', platform: 'bilibili',
      user: String(data.user_info?.uname ?? '观众'), uid: Number(data.uid) || null,
      text: body, superChat: true, price: Number(data.price) || 0,
    };
  }
  return null;
}

// WBI 签名：getDanmuInfo 需要它，否则返回 -352
export function mixinKey(imgKey, subKey) {
  const raw = String(imgKey) + String(subKey);
  return MIXIN_KEY_TAB.map(index => raw[index]).join('').slice(0, 32);
}

// 弹幕筛选：只留下值得回应的观众消息
export const FILTER_DEFAULTS = Object.freeze({
  minChars: 4, maxChars: 60, trigger: 'at', atWords: ['金宝', '@金宝'], keyword: '问',
  perUserMs: 30_000, queueMax: 5, spamRepeatRatio: 0.6,
});

export function createViewerFilter(options = {}) {
  const config = { ...FILTER_DEFAULTS, ...options };
  const seen = new Map();
  const lastByUser = new Map();

  const spamLike = text => {
    if (!text) return true;
    const counts = new Map();
    for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const top = Math.max(...counts.values());
    return top / text.length > config.spamRepeatRatio;
  };

  return {
    // 设置页切换触发方式时不需要重建筛选器。
    configure(patch = {}) { Object.assign(config, patch); },
    // 返回 {accept:boolean, reason?:string}
    check(message, now = Date.now()) {
      const text = String(message?.text ?? '').trim();
      const user = String(message?.user ?? '观众');
      const superChat = message.superChat === true;
      if (!text) return { accept: false, reason: 'empty' };
      // 醒目留言是花钱发的：放宽长度与触发词，只挡刷屏和频率。
      if (!superChat) {
        if (text.length < config.minChars) return { accept: false, reason: 'too_short' };
        if (text.length > config.maxChars) return { accept: false, reason: 'too_long' };
      } else if (text.length > 200) {
        return { accept: false, reason: 'too_long' };
      }
      if (spamLike(text)) return { accept: false, reason: 'spam' };
      if (!superChat) {
        if (config.trigger === 'at' && !config.atWords.some(word => text.includes(word))) return { accept: false, reason: 'no_trigger' };
        if (config.trigger === 'keyword' && !text.includes(config.keyword)) return { accept: false, reason: 'no_keyword' };
      }
      const signature = `${user}:${text}`;
      const last = lastByUser.get(user) ?? 0;
      if (now - last < config.perUserMs) return { accept: false, reason: 'user_rate' };
      if (seen.has(signature) && now - seen.get(signature) < 60_000) return { accept: false, reason: 'duplicate' };
      seen.set(signature, now);
      if (seen.size > 512) seen.delete(seen.keys().next().value);
      lastByUser.set(user, now);
      return { accept: true };
    },
  };
}

// 直播间连接（真实网络）。测试里注入 fake fetch/Ws。
export function createBilibiliDanmaku({
  roomId, fetchImpl = fetch, WsImpl = globalThis.WebSocket, now = Date.now,
  onMessage = () => {}, onStatus = () => {}, heartbeatMs = 30_000, cookie = '',
}) {
  let ws = null;
  let timer = null;
  let closed = false;
  const headers = () => ({ ...BROWSER_HEADERS, ...(cookie ? { cookie } : {}) });

  async function resolveRoom() {
    const response = await fetchImpl(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`, { headers: headers() });
    const payload = await response.json();
    const real = Number(payload?.data?.room_id);
    if (!real) throw new Error('room_not_found');
    return real;
  }

  async function danmuInfo(realRoom) {
    // WBI 签名需要 img/sub key，先取 nav
    const navRaw = await (await fetchImpl('https://api.bilibili.com/x/web-interface/nav', { headers: headers() })).json();
    const imgUrl = String(navRaw?.data?.wbi_img?.img_url ?? '');
    const subUrl = String(navRaw?.data?.wbi_img?.sub_url ?? '');
    const pick = url => url.split('/').pop()?.split('.')[0] ?? '';
    const imgKey = pick(imgUrl);
    const subKey = pick(subUrl);
    const { createHash } = await import('node:crypto');
    const params = { id: realRoom, type: 0, web_location: WEB_LOCATION };
    const key = mixinKey(imgKey, subKey);
    const query = new URLSearchParams({ ...params, wts: String(Math.floor(now() / 1000)) });
    const sorted = [...query.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const queryString = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v).replace(/[!'()*]/g, ''))}`).join('&');
    const wRid = createHash('md5').update(queryString + key).digest('hex');
    const url = `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoom}&type=0&web_location=444.8&w_rid=${wRid}&wts=${query.get('wts')}`;
    const payload = await (await fetchImpl(url, { headers: headers() })).json();
    const token = payload?.data?.token;
    const host = payload?.data?.host_list?.[0]?.host;
    if (!token || !host) throw new Error('danmu_info_failed:' + (payload?.code ?? '?'));
    return { token, host };
  }

  async function open() {
    const realRoom = await resolveRoom();
    const { token, host } = await danmuInfo(realRoom);
    onStatus({ state: 'connecting', roomId: realRoom });
    ws = new WsImpl(`wss://${host}/sub`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const auth = { uid: 0, roomid: realRoom, protover: 2, platform: 'web', type: 2, key: token };
      try { ws.send(packFrame(OP.AUTH, JSON.stringify(auth))); } catch {}
      timer = setInterval(() => { try { ws.send(packFrame(OP.HEARTBEAT, '[object Object]')); } catch {} }, heartbeatMs);
      timer.unref?.();
      onStatus({ state: 'connected', roomId: realRoom });
    };
    ws.onmessage = event => {
      const buffer = Buffer.from(event?.data ?? []);
      for (const frame of parseFrames(buffer)) {
        if (frame.operation === OP.AUTH_REPLY) onStatus({ state: 'authorized', roomId: realRoom });
        if (frame.operation !== OP.MESSAGE || !frame.text) continue;
        const message = parseDanmaku(frame.text);
        if (message) onMessage(message);
      }
    };
    ws.onerror = () => onStatus({ state: 'error' });
    ws.onclose = () => { onStatus({ state: closed ? 'closed' : 'disconnected' }); };
  }

  return {
    async start() { closed = false; await open(); },
    stop() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
      try { ws?.close(); } catch {}
      ws = null;
      onStatus({ state: 'closed' });
    },
    status: () => ({ state: ws ? 'open' : 'closed' }),
  };
}
