# 开局第一轮海克斯识别不出来（2026-11-19 晚）

## 现象与证据

第 1 局（22:53 开始）第 1 轮的识别日志：

```
augment_pick_undecided  roll=1  reason="panel-closed"  gameTime=21
card-watch-…-undecided-panel-closed  {"picked":null,"reason":"panel-closed","frames":9,"ms":833}
```

也就是说：**三张卡的名字都读到了**（秘术卫士 / 重量级打击手 / 逃跑计划），
但 watcher 在 833 毫秒、9 帧后就认定「面板已经关闭」并放弃。

## 根因

`card-watch.ps1` 判定面板关闭的条件是「三张卡同时大幅变化」——这在面板关闭时成立，
但**开局镜头推进、入场动画、整屏光照变化**同样会让三张一起变化。原实现只要**一帧**命中就 break，
于是第一轮（gameTime 21，正是开局镜头）被误杀。

同晚其它几轮还出现过 `game_not_foreground`：玩家在金宝悬浮窗里打字时，前台窗口不是游戏，
`capture-augments.ps1` / `card-watch.ps1` 直接返回「游戏不在前台」。

## 修法

1. **关闭判定要连续两帧**，且基线稳定超过 900ms 才生效；出现悬停/正常帧时把计数清零，
   避免零散单帧累积。
2. **前台容忍**：当前台窗口标题含「金宝」（我们自己的悬浮窗）时，不再判 `game_not_foreground`，
   而是按进程名找到英雄联盟窗口继续抓（PrintWindow 不需要窗口在前台）。

## 验证

`card-watch.ps1 -SelfTest` 新增一个用例「开局镜头让三张卡整体变一帧、随后正常悬停」：

```
{"soleDeviation":true,
 "globalChangeUndecided":true,"globalChangeReason":"panel-closed",
 "transientGlobalKeepsWatching":true,"transientGlobalReason":"sole-deviation",
 "staticUndecided":true,"staticReason":"timeout"}
```

- 单帧整体变化 → 继续观察并正确识别（新行为）
- 持续整体变化 → 仍判 panel-closed（原行为保留）
- 全程静止 → timeout（原行为保留）

## 发布

0.2.55，已安装。两个脚本都在打包清单里（`capture-augments.ps1` 23,321 字节 / `card-watch.ps1` 19,281 字节）。

## 仍需实战验证

第一轮是否稳定识别，要看下一局开局；如果仍失败，需要看新的 `card-watch-*` 目录里
`baseline.png` 与 `last.png` 的差异，判断是画面抓取问题还是判定阈值问题。
