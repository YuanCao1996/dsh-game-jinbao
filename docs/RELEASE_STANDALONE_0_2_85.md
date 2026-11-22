# 独立桌面版 0.2.85

发布：2026-11-22 14:2x（CST）
通道：feed + 官网 + GitHub Releases
版本：`0.2.85`（包内 `0.2.85-standalone-preview.1`）

## 本次内容（相对 0.2.80）

- 海克斯三选一出现时自动弹窄条排名（左/中/右 + 推荐），面板关闭即失效；
- 修复拖拽标记卡住导致「有声音、没字幕」；展开尺寸不再沿用被拖小的 300 宽；
- 击杀播报的击杀对象改用对方英雄名；
- 4 分钟没有建议时主动补一次局势分析（看门狗）；
- 任务失败记录状态/原因；busy 等待 12 秒而不是立即失败；
- 读取网关透传的上游失败 code（`user_context_capacity` / `agent_capacity` 等）。

## 服务端配套（已生效）

- DSH 单账号会话上限 8 → 32；
- 429 拒绝日志改为 WARNING，记录 code + owner 哈希；
- 网关透传上游 `{code}`；
- 网关启动不再因缺少某个模型 key 整体失败（跳过并记 `model_route_skipped`）；
- 视觉模型 key 通过 `96-vision.conf` 加载，`game-vision*` 路由恢复。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,948,995` 字节，sha256 `a61e7a1d28afc69729afccb3160f8e240fce8569c254581322a02eec6fc0b757` |
| manifest sha256 | `5b8f91bde4e93ee453aafea6963d352975eaf81b26c552790ec3bdcc21b41e60` |
| 应用层 zip | `7,867,505` 字节，sha256 `bd47ab85b6302ee56816422bd3152b4389660ef8c96c58ddf95defe190b4fd7b` |

## 事故记录

网关 `jinbao-desktop-agent-preview` 在 11-22 00:32 重启后启动失败（`model-routes.json`
引用 `DESKTOP_DASHSCOPE_API_KEY`，旧代码只允许 opencode key），服务 down 约 13 小时。
已修：缺 key 时跳过路由而不是整体退出，并用 drop-in 加载 `vision.env`；网关已恢复 active。