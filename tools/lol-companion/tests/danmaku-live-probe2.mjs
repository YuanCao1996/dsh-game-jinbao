import { createBilibiliDanmaku } from '../danmaku-bridge.mjs';

// 候选来源换几个接口试；能拿到任何正在直播的房间即可
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  referer: 'https://live.bilibili.com/',
};
const sources = [
  'https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=1&area_id=0&sort_type=&page=1',
  'https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=5',
  'https://api.live.bilibili.com/xlive/web-interface/v1/index/getList?platform=web',
  'https://api.live.bilibili.com/room/v3/area/getRoomList?platform=web&parent_area_id=0&page=1&page_size=5',
];
let picked = null;
for (const url of sources) {
  try {
    const payload = await (await fetch(url, { headers })).json();
    const rows = payload?.data?.list ?? payload?.data?.rooms ?? [];
    console.log(url.split('?')[0].split('/').slice(-2).join('/'), '→ code', payload?.code, '房间数', rows.length);
    if (rows.length) {
      picked = rows[0];
      break;
    }
  } catch (error) {
    console.log('接口失败:', error.message);
  }
}

// 兜底：直接用已知长期开播的房间号
if (!picked) picked = { roomid: 21452505, uname: '(兜底房间)' };
console.log('使用房间:', picked.roomid, picked.uname ?? '');

const got = [];
const bridge = createBilibiliDanmaku({
  roomId: String(picked.roomid),
  onStatus: status => console.log('状态:', JSON.stringify(status)),
  onMessage: message => {
    got.push(message);
    if (got.length <= 8) console.log('弹幕:', message.user, '→', message.text, message.superChat ? '[SC]' : '');
  },
});
bridge.start().catch(error => console.log('连接失败:', error.message));
await new Promise(resolve => setTimeout(resolve, 20_000));
bridge.stop();
console.log(`房间 ${picked.roomid} 20 秒收到弹幕: ${got.length} 条`);
process.exit(0);
