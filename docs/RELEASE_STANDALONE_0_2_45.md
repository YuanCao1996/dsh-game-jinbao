# 独立桌面版 0.2.45

发布：2026-11-18 22:0x（CST）

## 改的是什么

开黑队伍的开关**不再需要重启**。

原来的实现：开关只写 `team-rooms.json`，`main.mjs` 在启动时读一次 → 必须重启才生效，设置页还专门提示「下次启动生效」。

现在：

- 服务端把开黑桥（`createTeamBridge` + 本地路由）从启动时一次性创建改成**可随时建/拆**：
  `setTeamEnabled(enabled)` 负责创建或关闭，关闭时调用 `bridge.close()`；
- `POST /api/team/settings` 写完文件后**立即**建/拆桥，返回 `active` 表示当前是否真的可用；
- `/api/status` 的 `teamSupported`、`/team-room` 路由、侧栏入口都跟着实时变化；
- 设置页保存后立即同步侧栏（`syncTeamNav`），文案从「重启后生效」改成「已开启，立即可用」。

## 真机验收（不重启）

```
启动时            teamSupported=false，/team-room 403
POST enabled=true  → {"enabled":true,"active":true,"requiresRestart":false}
                    /team-room 200（立即可用）
POST enabled=false → {"active":false}，/team-room 重新 403
```

装到 0.2.45 之后在你机器上复验，结果同上（版本 0.2.45，开关来回切换均即时生效）。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | 41,146,705 字节，sha256 `94ede25e8527645057765e68832b63aa55b92452f74356bf07c4ff4ec4e77668` |
| 应用层 zip | 6,065,215 字节，sha256 `cb7d3f3fdb6070bed41eb9505591867d09d40be5e2707e114ca7ac2250b0cf21` |
