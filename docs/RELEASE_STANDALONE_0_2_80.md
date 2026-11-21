# 独立桌面版 0.2.80

发布：2026-11-21 23:0x（CST）
通道：independent standalone（feed + 官网 + GitHub Releases）
版本：`0.2.80`（包内 `0.2.80-standalone-preview.1`）

## 本次修复

- **拖拽标记卡住**：`$script:dragging` 在窗口外松开鼠标时不会清除，`Playback-Tick`
  每次开头就 return，表现为「能听到语音、字幕条一直不显示」。现在每 tick 检查鼠标
  左键状态，没按住就清掉标记。
- **展开尺寸过小**：大框尺寸曾被记成 301×446（或更小），之后每次展开都又小又窄。
  现在只记住 ≥360×300 的大框尺寸，展开下限 380×520。
- **击杀播报**：多杀/复仇里的击杀对象改用对方英雄名，认不出才退回去掉 `#tag` 的玩家名。
- **数据目录迁移**：设置页「磁盘占用 → 迁移数据目录…」可把状态目录迁到其他盘，
  用 junction 保持原路径不变，迁移后自动重启；本机已迁到 `D:\JinbaoData`。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,947,860` 字节，sha256 `c0ed3efff7998677ec083b38799de0e945f009c2cb5a476c1e9cf63578f52008` |
| manifest sha256 | `d1dfd4732798f1d9ed55bc7e721dce3b6641cb4fdbd75fc2543e479592009e67` |
| 应用层 zip | `7,866,370` 字节，sha256 `ebb1c6286f8ae1b939ebea530a6afc724a84f8eeb4d0bc2701fe7bdd862b2bf6` |
| 构建 | 干净 worktree（HEAD `672ce92`），Node 24.22.1 |

## 渠道同步

- 应用内 feed：0.2.80（旧 feed 备份 `latest.json.bak-*`）；
- 官网 `www.jinbaoai.top`：Windows 下载按钮 → `v0.2.80`（服务器
  `/opt/jinbao-website/website/index.html`，已备份）；
- GitHub Releases：`v0.2.80-standalone-preview.1`，附两个 zip：
  https://github.com/YuanCao1996/dsh-game-jinbao/releases/tag/v0.2.80-standalone-preview.1

## 已知问题

- 官网 Android 下载仍是 `1.0.1-beta.23`（本次未动）；
- 迁移后的自动重启依赖 `%USERPROFILE%\jinbao\jinbao.exe`，自定义安装路径的用户需要手动打开。
