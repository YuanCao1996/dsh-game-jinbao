import { packFrame, parseFrames, parseDanmaku, OP, mixinKey } from '../danmaku-bridge.mjs';

const log = (...args) => console.log(...args);

// A. 不带 token 直连弹幕服务器（老接口，很多房间仍可用）
async function tokenless() {
  return new Promise(resolve => {
    const got = [];
    let settled = false;
    const ws = new WebSocket('wss://broadcastlv.chat.bilibili.com/sub');
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(packFrame(OP.AUTH, JSON.stringify({ uid: 0, roomid: 6, protover: 2, platform: 'web', type: 2 })));
    ws.onmessage = event => {
      for (const frame of parseFrames(Buffer.from(event.data))) {
        if (frame.operation === OP.AUTH_REPLY) log('AUTH_REPLY:', String(frame.text).slice(0, 140));
        if (frame.operation === OP.MESSAGE) {
          const message = parseDanmaku(frame.text);
          if (message && got.length < 3) { got.push(message); log('弹幕:', message.user, message.text); }
        }
      }
    };
    ws.onerror = () => log('ws error');
    setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} log('A 结果：弹幕', got.length); resolve(got.length); } }, 12_000);
  });
}

// B. WBI 签名取 getDanmuInfo
async function wbi() {
  const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'user-agent': 'Mozilla/5.0' } })).json();
  const img = String(nav?.data?.wbi_img?.img_url ?? '').split('/').pop()?.split('.')[0] ?? '';
  const sub = String(nav?.data?.wbi_img?.sub_url ?? '').split('/').pop()?.split('.')[0] ?? '';
  log('nav code:', nav?.code, '| img:', img.slice(0, 8), '| sub:', sub.slice(0, 8));
  const key = mixinKey(img, sub);
  const wts = Math.floor(Date.now() / 1000);
  const params = { id: 6, type: 0, web_location: 444.8, wts };
  const query = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const { createHash } = await import('node:crypto');
  const wRid = createHash('md5').update(query + key).digest('hex');
  const url = `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}&w_rid=${wRid}`;
  const payload = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://live.bilibili.com/' } })).json();
  log('getDanmuInfo code:', payload?.code, 'message:', payload?.message, '| token:', !!payload?.data?.token, '| host:', payload?.data?.host_list?.[0]?.host);
  return payload?.code === 0;
}

log('=== A 无 token 连接 ===');
const a = await tokenless();
log('=== B WBI 签名 ===');
const b = await wbi();
log('结论: A(无token)=', a > 0 ? '可用' : '不可用', '| B(WBI)=', b ? '可用' : '失败');
