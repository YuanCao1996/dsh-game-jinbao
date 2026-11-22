# 独立桌面版 0.3.1

发布：2026-11-22 19:3x（CST）
通道：feed + 官网 + GitHub Releases
版本：`0.3.1`（包内 `0.3.1-standalone-preview.1`）

## 本次内容（相对 0.2.85）

- 海克斯：选完强化后必须等面板真正消失才允许下一轮，修复同一面板被记成两轮；
- 海克斯：动画判定失败时用点击坐标兜底选卡；
- 海克斯：保存 `augment-frames/<时间>/panel.jpg + slot*.jpg` 诊断截图，只保留真卡名；
- 播报统一英雄常用名（含羞蓓蕾→莉莉娅、铁血狼母→安蓓萨等）；
- 语音：客户端/服务端双端合成缓存 + 静默窗口内预合成；
- 悬浮窗：展开默认 280×369（可拖到 280 宽）；穿透恢复整条窄条可点；播报期间强制展开；
- 悬浮窗卡死 20 秒自动重拉；消息/页面/确认弹窗全量日志；
- 看门狗可越过 retryAt；任务失败 code 透传（0.2.85 已含）。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,960,743` 字节，sha256 `d39dc81958025dc8926caf99c068dcf8e645fa5188ecad1f505027cbc46cf9f0` |
| manifest sha256 | `54e5203185c72675c9b38ea5ae49e2616d56786c807c9c8c2f2feb5818a97096` |
| 应用层 zip | `7,879,253` 字节，sha256 `0b0e82b20d6010215bceb63359c79f6dc68a419afde0f6467fde7ac203511dfd` |
| 构建 | 干净 worktree（HEAD `cefffa9`） |

## 渠道同步

- 应用内 feed：`/var/lib/jinbao-independent-downloads/latest.json`（旧 feed 已备份）；
- 官网 `www.jinbaoai.top`：`/opt/jinbao-website/website/index.html` → `v0.3.1`（已备份）；
- nginx：新增 `/downloads/jinbao/v0.3.1/*` location，已 `nginx -t` + reload；
- GitHub Releases：`v0.3.1-standalone-preview.1`，附两个 zip；
- 服务端 TTS：`agent_dsh/speech.py` LRU 缓存（TTL 600s/200 条/32MB）。

## 验证

- `https://api.jinbaoai.top/downloads/jinbao/v0.3.1/jinbao-desktop-windows.zip` → 200，42,960,743 字节；
- feed 公网返回 `version=0.3.1`；
- 官网下载按钮指向 `v0.3.1`。