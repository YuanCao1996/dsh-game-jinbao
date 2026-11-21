# 独立桌面版 0.2.74

发布：2026-11-21 22:1x（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.74`（包内 `0.2.74-standalone-preview.1`）

## 本次内容

磁盘占用治理，针对所有用户（不是单机清理）：

- **旧版本**：只保留当前运行版 + pending/active/previous 回执 + 最新 2 版，
  其余从 `updates/releases` 删除；启动后 30 秒执行一次，之后每 24 小时一次；
- **对局记忆**：30 天 / 最多 300 个 / 总计 300MB，按修改时间删最旧；
- **对局日志**：14 天 / 总计 400MB，10 分钟内正在写的文件不动；
- **旧目录**：`logs-archive-stale`、`logs-archive`、14 天前的 `card-watch-*`、`staging-*`；
- **占用统计按硬链接去重**（更新包里的 node.exe 只算一次）；
- 设置页「维护与诊断」新增磁盘占用明细 + 「清理旧版本 / 清理日志与记忆」按钮；
- 新接口：`GET /api/storage`、`POST /api/storage/cleanup`（target: all/releases/memory/logs/legacy）。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,943,635` 字节，sha256 `e6f61abf6229596e681964574b28d02dbefd7eb91c9a0ad07415f633e265f7ad` |
| manifest sha256 | `5b5facb0c2ec4f44922938e590522731d45e0560345d9ad80728b16be07b24a9` |
| 应用层 zip | `7,862,145` 字节，sha256 `e70d4d5463336280cdd5ba3fe7e43ab1e867bcab8c8c6616dd5ed1ad46d6a93b` |
| 构建 | 干净 worktree（HEAD `900b713`），Node 24.22.1 |

## 本机效果

| 项 | 优化前 | 优化后 |
|---|---|---|
| 状态目录 | 4,030 MB | 721 MB |
| 更新版本 | 31 个 | 2 个 |
| 对局记忆 | 676 MB | 303 MB（上限生效） |
| 旧日志归档 | 113 MB | 0 |

C 盘剩余：7.1 GB → 7.7 GB。

## 过程备注

- 首次提交（`a1d3414`）误带了另一会话 `main.mjs`/`settings.html` 的未完成 collector 改动，
  干净 HEAD 无法构建；已用 `900b713` 回退并只保留存储改动，干净 worktree 构建通过。
  误带的 WIP 备份在 `D:\work\DSH\handoff\codex-wip-20261121-2200`。
- 后续可选：数据目录迁移到其他盘（junction，无感）、安装目录迁移。

## 回滚

发布前的 feed 备份为 `latest.json.bak-*`（指向 0.2.73）。
