# 独立桌面版 0.3.15

发布：2026-11-22 22:4x（CST）
通道：feed + 官网 + GitHub Releases
版本：`0.3.15`（包内 `0.3.15-standalone-preview.1`）

## 本次内容（相对 0.3.1）

- 海克斯：开局 2–3 张精确卡名首帧识别；新对局清空 `decidedRolls`，修复选卡判定被上一局吞掉；选定即关闭本轮；大框自动切海克斯页；
- 播报：敌方关键装备点名；队友挂机不再播报；局势估计去掉百分比；满六件只评估替换；散件不播报；负反馈点名所选；
- 采集：LCU 进入 InProgress 立即切新局，不再等旧 Live 数据；
- 悬浮窗：默认 280×369、穿透整条可点、去掉复制菜单、播报期间强制展开、心跳 20 秒自动重拉；
- 语音：合成双端缓存 + 静默窗口预合成。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,962,084` 字节，sha256 `48f8e6bae9e5ebd0f1d04a44b4874d084139a4a5b6ef7e8c10ae66b20d41d044` |
| manifest sha256 | `370363305dc9e67198d725ac26ecf9eb848de60785665f6e33dc16fdc24a0d01` |
| 应用层 zip | `7,880,594` 字节，sha256 `7b019c92d927919b93180ca9b744cc904b608da87094639921da54d881d7b138` |
| 构建 | 干净 worktree（HEAD `5f73e01`） |

## 渠道同步

- 应用内 feed：`/var/lib/jinbao-independent-downloads/latest.json`（旧 feed 已备份）；
- 官网：`/opt/jinbao-website/website/index.html` → `v0.3.15`；
- nginx：新增 `/downloads/jinbao/v0.3.15/*`，已 reload；
- GitHub Releases：`v0.3.15-standalone-preview.1`；
- 本机已通过签名包安装 0.3.15。