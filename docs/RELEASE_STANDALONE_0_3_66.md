# 独立桌面版 0.3.66

发布：2026-11-27（CST）

## 更新失败恢复

- 根因：独立版由 `createStandaloneUpdates` 控制器代理更新，之前只暴露 `check/apply`，没有暴露 `retry`；设置页“重试更新”仍走原 `check`，被 `updates/rejected.json` 永久挡住。
- 修复：
  - `updates.mjs` 暴露 `retry()`；
  - 服务端 `/api/update/check` 使用 `retry()`；
  - `retry()` 清除 `rejected.json` 后重新检查/下载。
- 本机验证：写入 `rejected.json` 后调用 `/api/update/check`，标记被清除，状态回到 `current`。

## 悬浮窗宽度

- 默认 XAML 宽度 `380 → 300`；
- 最小宽度 `420 → 280`；
- 保存宽度阈值 `420 → 280`。

## 显示

- 全界面玩家名→英雄常用名，去称号。

## 验证

- 本机从 0.3.65 增量升级到 0.3.66；
- updater 测试 7 项、overlay 测试 8 项全过。