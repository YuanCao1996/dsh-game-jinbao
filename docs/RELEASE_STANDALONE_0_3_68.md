# 独立桌面版 0.3.68

发布：2026-11-28（CST）
重点：调高服务端预算 + 保留真实远端错误码。

## 服务端（已生效）

文件：`/var/lib/jinbao-desktop-deploy/cloud-dsh-poc-20261024/runtime-backend/agent_dsh/tasks.py`

- 任务提示词上限 `8000 → 12000`，与客户端一致；
- 会话历史预算 `16,000 字节 → 64,000 字节`，保留上限 `200 → 400` 条；
- 超过 64KB 时自动删除最旧对话，不再直接 409；
- 自动任务仍不写会话历史；
- 已备份 `tasks.py.bak-*`，`jinbao-dsh.service` 已重启并 active。

## 客户端

- `cloud-agent` 在 HTTP 错误上保留 `remoteCode`；
- `auto-coach` 用真实 `conversation_budget_exceeded` / `invalid_message` 记录 `coach_failed.code`，不再统一写成 `agent_request_failed`；
- 会话预算/请求过长改为 120 秒退避，不高频重试；
- 补上 `allies` 默认值，避免空名单上下文崩溃。

## 验证

- 服务端重启后，本机手动提问 HTTP 200，正常返回；
- `auto-coach` 测试 7/7 通过；
- 0.3.67 → 0.3.68 增量升级成功。