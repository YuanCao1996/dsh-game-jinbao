# 独立桌面版 0.2.37 / 0.2.38

发布：2026-11-17 09:5x / 10:1x（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）

## 0.2.37：日记口吻修正

第一篇真实日记（11-15，来自玩家自己的对局）暴露了三处问题，都来自提示词：

| 问题 | 修法 |
|---|---|
| 她把自己写成了上场的人（「我攒出女妖面纱先进去，我剩一丝血站塔下」） | 明确：你不上场，只在旁边看他打、在旁边说话；不写自己补刀/出装/开团/残血 |
| 她把自己播报过的话写成「他打的字」 | 素材里标注「你自己说过（不是他说的）」；引号里的话只能来自「他打的字」 |
| 编了没给过的装备名 | 英雄名、装备名只能用素材里出现过的，没给就写「那件防装」 |

## 0.2.38：修上一版引入的严重问题

0.2.36 我加日记定时器时，一次批量编辑把 `const speechTimer=setInterval(()=>speech.tick(),500);` **整行吞掉了**，后果两个：

1. **语音队列不再推进**（播报不出声）；
2. 退出时 `quiesce` 抛 `ReferenceError: speechTimer is not defined` → 关机记录为「有失败步骤」→
   `notifyRestart` 因 `failed.length` 而不发 restart 信号 → **装完更新应用直接关掉，不自动重启**。

修法：补回语音时钟；新增 `tools/cloud-desktop/tests/main-timers.test.mjs`——
静态检查「每个 `setInterval` 都必须有对应的 `clearInterval`，且必须存在 `speechTimer`」。
本地用 IPC 发 stop 验证：退出码 0、`shutdown-state: completed`、`failedSteps: []`。

## 发布过程中的两个事故（都已修复）

1. **nginx 配置带 BOM**：用 PowerShell `Set-Content -Encoding UTF8` 写的 location 片段开头有 `EF BB BF`，
   `nginx -t` 报 `unknown directive "﻿"`。当时 nginx 仍在用旧配置跑（站点未中断），
   回滚备份后用无 BOM 写入重做。
2. **包与清单对不上**：快捷方式脚本会在 `manifest.json` 生成**之后**往包里写 `jinbao.ico`，
   于是 `verifyPackage` 报 `Unexpected package file`，**0.2.37 全量/应用层都装不上**。
   修法：把快捷方式步骤移到生成清单之前（图标因此进清单），重新打包并用 `verifyPackage` 本地验证后重发。

## 验证

```
0.2.37 feed 验签 / HEAD / Range     通过
0.2.37 应用层更新（本地 verifyPackage）通过
0.2.38 feed 验签           0.2.38  41,317,645 / app 6,236,155
全量与应用层 HEAD 200      长度一致
真机应用层更新              从 0.2.37 升级：15.4 秒，477 个文件，硬链接未复制
干净退出                    exit 0 / completed / failedSteps 为空
安装后状态                  0.2.38 从 updates/releases/v0.2.38 启动，/diary 200
```

## 经验

- 批量文本替换后必须跑一次「装配烟测」（build → boot → 关键路由），这次 `speechTimer` 丢失就是编译器抓不到的。
- 发版前要拿**构建产物**过一遍 `verifyPackage`，而不是只跑单测：包与清单不一致只有这一步能发现。
- 服务器配置片段一律用无 BOM 的 UTF-8 写入。
