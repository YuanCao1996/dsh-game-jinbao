# 独立桌面版 0.3.58

发布：2026-11-27（CST）
通道：feed + 官网 + GitHub Releases + 本机安装验证

## 修复

- 0.3.56/0.3.57 启动失败根因：
  - 清洁构建缺少 `champion-kits.json`、`item-components.json`、`item-name-ids.json` 运行时数据文件；
  - `overlay-ui.ps1` 残留括号导致悬浮窗脚本解析失败。
- 0.3.58 已在干净 worktree 验证 `managedEntry` 就绪、本机安装成功。

## 内容

- 手动提问：思考流只在顶部智能体动态行，最终回复进聊天框；新提问抢占旧问题；登录失效自动重试；
- 装备建议结合敌方阵容、四技能与海克斯记录；推荐出装六件，优先采用海克斯调整方案；
- 海克斯识别修复：重名英雄误归属、同行标题拆分、购买目标校验、标签残片过滤；
- 悬浮窗脚本语法/BOM 修复；回答到达自动展开战况页。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `43,078,199` 字节，sha256 `3cd4e94171d87172c5f2c77cd707b47213ebcc35640a8403bb426605d2cde292` |
| manifest sha256 | `7c63d4d204baf7f6f3876ee3402f08499951c5fd0f25874657d744c144c1e806` |
| 应用层 zip | `7,996,709` 字节，sha256 `7d49549a058874d39fa6b7e9f2da140c308ad0c81d1c2eb79c0d9fa9e70125cb` |
| 文件数 | 553 |

## 渠道

- feed 已签名，`version=0.3.58`；
- 官网下载指向 `v0.3.58`；
- nginx `/downloads/jinbao/v0.3.58/*` 已 reload；
- GitHub Release `v0.3.58-standalone-preview.1`；
- 本机安装成功，main 进程运行在 `releases\v0.3.58`。