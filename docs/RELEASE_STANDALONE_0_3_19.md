# 独立桌面版 0.3.19（本地预览，未发布线上）

构建：2026-11-24 14:1x（CST）
通道：**仅本机安装**；线上 feed / 官网 / GitHub Releases 仍为 0.3.15。
版本：`0.3.19`（包内 `0.3.19-standalone-preview.1`）
构建：干净 worktree（HEAD `52f6345`），Node `v24.22.1`

## 本次内容

- 悬浮窗展开态「双方阵容」表格：英雄列加入头像（随包本地 173 张 128×128 图 +
  `champion-aliases.json`，完全离线，缺图回退首字色块）。
- 标题下方新增一条紧凑图标行：`装备 [自己 6 件] 敌方 [关键成装]`，
  物品 id → `/item-icon/<id>.png`（服务端首次从 CDragon 拉取并落盘，之后本地读取；
  断网/缺图自动回退文字，不影响布局）。
- 装备观察事件补充物品 id（`itemRows`），供图标解析；首帧即显示已买装备。
- 预取/图标加载均在后台完成，不阻塞对局页面。

## 实测

- 打包后干净安装，应用自动升级并重启到 0.3.19；
- `/item-icon/3031.png`、`/item-icon/3089.png` 均返回 PNG 并写入状态目录
  `item-icons/`，未知 id 返回 404；
- 用真实检索服务渲染离屏预览验证：十人阵容每行头像正确、装备/敌方图标行正常；
- 打包内嵌自测（`-SelfTest`）头像解析、阵容行图标、装备图标行全部通过。

## 产物（本地）

| 项 | 值 |
|---|---|
| 全量 zip | `42,976,201` 字节，sha256 `f9546f714dd963f95a66d03617a3346d91286526eec59696de30dace51151bb3` |
| manifest sha256 | `b709918a6f2b5719cdca58bf68b724a17bee4f0824542822fce5c95445d56549` |
| 应用层 zip | `7,894,711` 字节，sha256 `a74b55dc64362529d426723736b55c16d08565f99bed8802bc57cac8c8f4e2d1` |
| 运行时 node | `24.22.1`（sha256 `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`） |

## 本机安装

- 签名 envelope 走独立更新通道 → `~/.jinbao-cloud-preview/updates/releases/v0.3.19`；
- `apply-status: complete`，运行版本 `0.3.19-standalone-preview.1`，心跳正常。

## 未做

- 未上传服务器、未修改线上 feed / 官网 / GitHub；
- 未推送 commit 到远端（仅本地）。
