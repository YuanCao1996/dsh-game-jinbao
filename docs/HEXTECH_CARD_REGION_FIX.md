# 海克斯卡片识别：采集区域修正（2026-11-21，未发版）

## 问题

`card-watch` 原先按 `y = 0.35h、高 = 0.11h` 裁三张卡，1080p 下只覆盖 y 378–497 ——
正好是卡片的**名字条**。卡片美术、选中描边、按下放大全在框外，三张卡的差分只剩文字发光：

```
peak = 30.4 / 37.6 / 25.5   比值 1.24（判定要求 1.6）
peak = 17.3 / 24.3 / 19.3   比值 1.26
peak = 14.5 / 20.6 / 17.2   比值 1.20
```

证据：`card-watch-1795188153321-undecided-panel-closed/baseline.png` 只有「利刃华尔兹 / 史上最大雪球 /
终极唤醒 + 伤害/功能」，`last.png` 是计分板。产物留档在 `artifacts/hextech-watch-1120/`。

## 改动

1. **采集区域**：`高 0.11h → 0.36h`、`y 0.35h → 0.14h`（1080p 覆盖 y 151–540，含整张卡）。
2. **判定放宽**：`max ≥ Threshold && max ≥ 12 && (差值 ≥ 8 或 比值 ≥ 1.6)`——整张卡之后
   选中与次高的比值常常只有 1.2，只看比值会漏。
3. **诊断字段**：`watch.json` 增加 `guess`（峰值最大的槽位）。下一局即使仍判不出，
   也能从 `guess` 看它指向哪张，判断是阈值问题还是区域问题。

## 自检

`card-watch.ps1 -SelfTest`（Windows PowerShell 5.1，与线上一致）：

```
soleDeviation            true
globalChange             panel-closed
transientGlobalKeepsWatching true
staticUndecided          true
```

## 还需要一局实战确认

下一局海克斯面板出现后看两个地方：

- `card-watch-*/baseline.png` 里是否能看到**整张卡**（图案 + 名字 + 描边）；
- `watch.json` 的 `picked` / `guess` / `peak`。

如果区域仍偏，按 `baseline.png` 里卡片实际占比再调 `y` 与 `h` 两个系数即可。
