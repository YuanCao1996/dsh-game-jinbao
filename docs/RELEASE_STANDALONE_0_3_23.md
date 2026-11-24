# 独立桌面版 0.3.23（本地预览，未发布线上）

构建：2026-11-25
通道：本机验证构建；线上 feed / 官网 / GitHub 仍为 0.3.22（除非另行批准发布）。
版本：`0.3.23`（包内 `0.3.23-standalone-preview.1`）

## 修复内容

### 1. 自动教练被网关 400 拒绝（P0）
- 现象：一局 15 分钟里 23:05–23:14 共 19 次自动教练任务快速失败，
  `desktop_agent_unavailable`，中后期基本没有模型建议。
- 根因：桌面 Agent 网关 `/tasks` 校验 `message ≤ 2000 字`，客户端提示词预算
  `fitPromptBudget` 最多 7800 字；自动提示词带上工作方式/口头播报要求后可能超过 2000，
  网关返回 400，客户端统一显示 `desktop_agent_unavailable`。
- 服务端热修：`/var/lib/jinbao-desktop-deploy/cloud-dsh-poc-20261024/runtime-desktop/cloud-agent/handler.mjs`
  上限 2000 → 12000；备份 `handler.mjs.bak-20261125000730`；`systemctl restart
  jinbao-desktop-agent-preview.service`；实测 2001/5000 字均返回 202。
- 客户端：提示词预算保持 7800，网关已留出余量。

### 2. 海克斯推荐播报排队过期（P1）
- 现象：第一轮海克斯 23:02:13 结束，推荐 23:09:49 才播，延迟 7 分 36 秒；
  第三轮提醒占屏 179 秒。
- 修复：`strategy-overlay.ps1` 的 offer 播报加 45 秒过期；新 offer/面板关闭时
  `Remove-AugmentOfferPlayback` 清空排队和正在播的旧 offer；移出时不裁上下文动词。
- 自测新增：`offerPlaybackExpired` / `offerPlaybackQueued` / `offerPlaybackPurged`。

### 3. 海克斯词表与形近字（P1）
- 本地词表从 279 条补齐到 474 条有效名（CDragon 600 行去重/过滤），包含
  `过量延伸者`（id 2119，金色）。
- `augment-observer.mjs`：已被形近字唯一纠正的卡不再重复上报「未收录」，
  修掉 `可武器 → 可靠武器` 仍报缺卡的问题。
- 新增 `sync-augment-names.mjs` 便于后续同步。

### 4. 播报装备名纠偏（P2）
- 新增 `item-names.json`（CDragon 530 个装备名）与 `item-name-verify.mjs`。
- 播报出口只在本局出现过的装备名里做唯一形近纠正：
  `奥拉夫胫甲 → 狂战士胫甲`；普通词（如「下一件装备」）不误改，本局没有的装备不猜。
- 已接入 `auto-coach.mjs` 的 situation / actionable 两条播报路径。

'## 5. 客户端提示词上限对齐（P0 配套）

- `cloud-agent.mjs` 的 message 上限 8000 → 12000，与热修后的网关一致，避免边界提示词再被客户端 413。

## 6. 悬窗健康状态重写（P2）

- `overlay-supervisor.mjs`：同一健康状态每 30 秒也重写 `overlay-health.json`；
  之前若某次写文件失败，健康文件会永远停在 `starting`，诊断/恢复看不到真实状态。
- 单测补了同状态重写用例；同时修正原有用例中把 29 秒心跳误当 10 秒 unresponsive 的时间点。

## 验证'

- 网关实测：2000 字接受；2001/5000 字接受（热修后）。
- `strategy-overlay.ps1 -SelfTest`：新增播放队列断言全部 true。
- 海克斯观察器回归：6/6 通过；未知卡链路 1/1 通过。
- 装备名纠偏 4/4 通过。
- 全量 zip：`43,169,930` 字节，sha256 `29a2839e149cde29891cd4ddf30699e2252b5daed4f6671bd0001ac82728a420`
- manifest sha256：`1293349109dc8da16047f2729e51cf899778b66e2c560b2d1275864f97229fd4`
- 应用层 zip：`8,088,440` 字节，sha256 `192f65affeb7934d7e76b15b073bcc9531b994ed1e3e050874ed7495857f0854`
- 构建 worktree：`C:\Users\Administrator\jinbao-build-0323`（HEAD `86d6cd0`），产物 `jinbao-out-0323` / `jinbao-dist-0323`。

## 线上服务端改动记录

- `jinbao-desktop-agent-preview.service` 热修已上线；原文件备份见上。
- 未改线上 feed / 官网 / GitHub。