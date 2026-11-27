# 独立桌面版 0.3.56

发布：2026-11-27（CST）
通道：feed + 官网 + GitHub Releases

## 内容

- 手动提问：思考流只在顶部智能体动态行，最终回复进聊天框；新提问抢占旧问题；登录失效自动重试；
- 装备建议结合敌方阵容、四个技能与海克斯记录；推荐出装展示六件，优先采用海克斯调整方案；
- 海克斯识别修复：重名英雄误归属、同行标题拆分、购买目标校验、标签残片过滤；
- 悬浮窗修复脚本语法与 UTF-8 BOM；回答到达自动展开战况页。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `43,021,622` 字节，sha256 `150cb62b207379c3331c1c0acdaac6892189cc4cae23cf23abada4d23551ea3f` |
| manifest sha256 | `89c86cece3c5657950169bdae4c8fe2868c640107c69faf1f7e6008046c2726a` |
| 应用层 zip | `7,940,132` 字节，sha256 `9a049c8bc9b7e221708206001cc27ddc8e658819dd2c10bf1e7a2c999ebf4f6d` |
| 构建 | 干净 worktree（HEAD `b0ae732`） |

## 渠道同步

- feed：`/var/lib/jinbao-independent-downloads/latest.json`（旧文件已备份）；
- 官网：`/opt/jinbao-website/website/index.html` → `v0.3.56`；
- nginx：新增 `/downloads/jinbao/v0.3.56/*`，reload 成功；
- GitHub Releases：`v0.3.56-standalone-preview.1`。