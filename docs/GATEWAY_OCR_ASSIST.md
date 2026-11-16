# 网关：视觉补识别（ocr_assist）通道

2026-11-16 上线。目标：让「本地 OCR 读不准时补读卡名/聊天行」这条链路能关思考、能流式，
同时不影响教练回合（教练仍走默认思考配置）。

## 服务端改动（api.jinbaoai.top，`/opt/jinbao-desktop`）

只对带 `X-Jinbao-Operation: ocr_assist` 的请求生效，其余请求行为完全不变。

1. `server/commercial.mjs`
   - `validateChat(body, { ocrAssist })`：`ocrAssist` 时额外允许 `thinking` 与 `reasoning_effort`；
   - `thinking` 只接受 `{type:"enabled"|"disabled"}`，`reasoning_effort` 只接受 `low|high|max`；
   - 处理器从请求头判定 `ocr_assist` 并传入校验。
2. `models/upstream.mjs`
   - Go 路由（opencode_go）不再强制 `stream:false`：请求要求流式时透传，并返回真正的 SSE
     （原先是一次性拿完再包成假流，所以首字节=结束时间）；
   - 带 `thinking` 的请求不再附加 `reasoning_effort:"low"`。
3. `models/images.mjs`
   - `validateImageUrl(value, { allowDetail })`：ocr_assist 时允许 `image_url.detail`
     （`low|high|auto|original`），其余请求仍只允许 `url`。
4. nginx 无需改动：`location = /v1/chat/completions` 本来就有 `proxy_buffering off`。

备份：`/opt/jinbao-desktop-backups/ocr-assist-20261116-225626`（commercial/upstream）、
`/opt/jinbao-desktop-backups/ocr-assist-20261116-225821`（images/commercial）。
回滚：拷回备份 → `systemctl restart jinbao-desktop`。

## 上线后实测（生产网关，同一账号）

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 文本「只回复 ok」 | 3.55 s，reasoning 12 | 2.17 s，reasoning 0 |
| 文本 + 流式 | 首字节=总时长 | **首字节 1.66 s** |
| 卡面（三张标题） | 5.7–9.7 s，reasoning 550+ | **3.0–6.4 s**，reasoning 0，三个卡名全对 |
| 聊天裁剪（三行） | 20.6 s 且为空 | **5.0 s**，三行全对 |

- 不带 `ocr_assist` 头时发 `thinking` 仍然 400（旧行为保持，教练链路未受影响）。
- `thinking:{type:"bogus"}` → 400。
- 延迟波动主要来自 opencode_go 自身（文本空闲时也有 2.6–5.3 s 抖动），图片理解再叠加 1–3 s。

## 客户端

`tools/shared/vision-assist.mjs`：

- 请求带 `X-Jinbao-Operation: ocr_assist`、`thinking:{type:"disabled"}`、`image_url.detail`（默认 low）；
- 网关若仍拒绝 `thinking`（回到旧版），自动去掉该字段重发一次并记住；
- **自适应档位**：`level 0` 用 `game-vision`（qwen3.5-ocr）关思考抄字 → 连续两次解析失败或调用方
  回报"读错了"升到 `level 1`（`game-vision-chat` / qwen3.7-flash，关思考）→ 再错升到 `level 2`
  （qwen3.7-flash + 思考）；连续两次超过预算（卡面 1.5 s、聊天 2.5 s）或稳定成功 5 次则降档；
- 网关没部署视觉路由时（`model unavailable`）自动退回 `game-fast`，功能不会整体失效；
- 档位、预算、失败计数都在 `stats()` 里可见。

## 视觉快速通道（DashScope，2026-11-16 追加）

opencode_go 自身抖动 2.6–5.3 s，卡面只能做到 3–6.4 s，对 5 秒面板仍然临界。第二条路是
DashScope 兼容接口（服务器上本来就有 Key）：

- 新路由（`/etc/jinbao-desktop/model-routes.json`）：
  - `game-vision` → `qwen3.5-ocr`（纯 OCR，最快）
  - `game-vision-chat` → `qwen3.7-flash`（语义读图，升档用）
  - 两者 `provider: dashscope`，`baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1`
- 凭据：`/etc/jinbao-desktop/vision.env`（600，内容 `DESKTOP_DASHSCOPE_API_KEY=…`，值取自
  `/etc/jinbao/.env.production` 的 `DASHSCOPE_API_KEY`）+ systemd drop-in
  `/etc/systemd/system/jinbao-desktop.service.d/vision-env.conf`；`server/main.mjs` 的凭据引用
  白名单从 1 个扩到 2 个。
- `models/upstream.mjs`：dashscope 路由把 `thinking` 翻成 `enable_thinking`，并去掉
  `reasoning_effort` 与 `image_url.detail`（DashScope 不认这两个字段）。

### 网关实测（同一批真实帧，含网关开销）

| 场景 | game-fast（opencode_go） | game-vision（qwen3.5-ocr） | game-vision-chat（qwen3.7-flash） |
|---|---|---|---|
| 卡面三标题 | 3.4 s | **0.45–0.62 s，全对** | 0.64 s，全对 |
| 聊天三行 | 5.0 s，全对 | **0.65–0.69 s**，三行基本正确 | 0.89–1.6 s，个别字更差 |
| 聊天 + 开思考 | — | — | 14 s，没有更好 |

结论：**卡面与聊天都用 `game-vision`（qwen3.5-ocr）**；`game-vision-chat` 只作为"读错了升级"的
第二档，第三档才开思考。

### 接线（collector，2026-11-17）

- **侧车图**：`capture-augments.ps1` 每次抓帧顺带写两张 JPEG——
  `<StateDir>\vision-strip.jpg`（三张卡标题带，约 1.6k×190）和 `vision-chat.jpg`（聊天框裁剪，840×400）；
  `JINBAO_VISION_FRAMES=0` 可关。`capture-worker.mjs` 负责把 `-StateDir` 传给 worker。
- **触发点**：`collector.mjs`
  - 海克斯：`augment_offer` 里有卡名吸附不上 `augment-names.json` 时，同一轮只补读一次
    （`vision-verify.mjs` 校验侧车图新鲜度 ≤2.5 s），成功则追加 `augment_offer_corrected`；
  - 聊天：本地一行都没解析出来、但 `frame.chatLines > 0` 时，最多每 4 s 补读一次，
    补读回来的行仍走 `chatObserver.observeLines()` 同一条解析/纠错链路。
- **采用门槛**：卡名必须吸附到名录且至少 2 个成立；聊天行必须非空。模型结果一律不直接落库。
- **开关**：`JINBAO_VISION_ASSIST=0` 整体关闭；`JINBAO_VISION_TIER=free|basic|plus` 选额度档位；
  全部调用记 `vision_assist` 诊断事件，采纳结果另记 `augment_offer_corrected` / `chat_vision_lines`。
- **复用**：`chat-observer.observe()` 现在接受 `chatOnly` / `chatLines` / `lines` 三种来源
  （此前只认 `chatOnly`，采集脚本给的是 `chatLines`，聊天解析被静默跳过）。


```bash
cp /opt/jinbao-desktop-backups/ocr-vision-<时间>/{main.mjs,upstream.mjs,model-routes.json} …
rm /etc/systemd/system/jinbao-desktop.service.d/vision-env.conf
systemctl daemon-reload && systemctl restart jinbao-desktop
```

