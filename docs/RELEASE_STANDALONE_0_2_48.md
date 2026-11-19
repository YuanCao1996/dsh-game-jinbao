# 独立桌面版 0.2.48

发布：2026-11-19 20:5x（CST）

## 一、对局胜负终于记得下来（148 局全是 null）

**现象**：`game-memory/match-history.jsonl` 148 条记录，`result` 全部为 `null`。
后果：胜率、连败洞察、周回顾的判断依据全空。

**根因**：链路断在字段名上——
- 客户端在处理 `GameEnd` 时只写 `state.matchWin`（布尔）；
- 而 `match-summary.js` 读的是 `state.result` / `me.result`（字符串），两个字段从来没人写；
- 另外 `overlayView()` 的快照投影里根本没有 `matchWin`，所以就算存盘也带不上。

**修法**：
- `overlayView()` 增加 `matchWin`（布尔）到快照；
- `summarizeMatch()` 在 `result` 缺失时回退到 `matchWin` → `'win'` / `'loss'`；显式 `result` 仍然优先。

**验证**（用已安装的 0.2.48 回放昨晚两局日志）：

```
lol-live-1795012452269  matchWin=false  摘要 result=loss
lol-live-1795013738108  matchWin=true   摘要 result=win
```

## 二、朗读不再只念第一句

**现象**：55 条播报里 33 条的朗读文本短于原文；典型两条：
- `赢啦！这波开得漂亮` → 只念 `赢啦！`
- `…跟祖安狂人往前压吧。下次购买优先帽子、中亚呀。` → **购买建议整段没念**

**根因**：`briefSpeech()` 为了"听到的和看到的对得上"，只取第一句（`^[^。！？!?]*`），
第二句无论多重要都被丢掉。

**修法**（按优先级）：
1. 前两句合起来 ≤ 60 字 → **都念**（多数建议落在这一档）；
2. 首句过长、但后一句是「购买 / 下一件 / 合成 / 出装 / 攒」这类可执行句 → 优先念它（必要时把首句截短）；
3. 首句过长 → 在标点处截断加省略号；
4. 完全没有句读的超长文本 → 仍然不念（噪声保护保留）。

**验证**：同一句话现在完整念出，包含「下次购买优先帽子、中亚呀」。

## 测试

```
advice-speech        9 项（新增 3 项：两句合并、短句组合、首句过长优先念购买句）
match-summary        5 项（新增 1 项：matchWin → win/loss，显式 result 优先）
overlay-ended        4 项（新增 1 项：GameEnd → overlayView.matchWin → 摘要 result）
相关套件合计 27 项全过
```

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | 41,147,867 字节，sha256 `8f8957e018e77534dc1e59b5b7d969d12451d0bbcfa7e7681cfb6db4c69dd7e9` |
| 应用层 zip | 6,066,377 字节，sha256 `6b18a260956d40a3eaa3f59e8062bd58c22bde28ce4caef941ecc4a957c69445` |
| 安装 | 0.2.47 → 0.2.48 自动重启，shutdown completed |

## 仍未处理（下一批）

- 教练太慢：p50 18.5s、出装类 p50 47.7s，瓶颈在模型生成（工具 1ms）；服务端日志 2×task_timeout、1×invalid_model_response
- 同一建议重复播（postAugment×9，其中 3 条语义重复）
- 悬浮窗心跳 stale 9 次（对局中 3 次）
- 同一海克斯面板重复起 watcher（5 组里 2 组）
