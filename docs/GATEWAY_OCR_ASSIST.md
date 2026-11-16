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
- **自适应档位**：`level 0` 关思考抄字 → 解析失败/调用方回报"读错了"连续两次升到 `level 1`
  （thinking enabled + effort low）→ 再错升到 `level 2`（effort high）；连续两次超过预算
  （卡面 4 s、聊天 7 s）或稳定成功 5 次则降档；
- 档位、预算、失败计数都在 `stats()` 里可见，便于诊断。
