<div align="center">

<img src="tools/dsh-onboarding/welcome/advice.gif" alt="金宝在英雄联盟对局中给出实时建议" width="720">

# 金宝 · 游戏教练

**坐在你旁边一起打的那位老玩家 —— 不是又一个数据面板。**

读取游戏日志，在桌面悬浮窗里说人话：这一波该打谁、这件装备为什么先出、刚才那波输在哪。

[![License](https://img.shields.io/badge/license-MIT-1f6feb?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square)](#-快速开始)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square)](https://nodejs.org)
[![Release](https://img.shields.io/badge/release-v0.2.17-c9863f?style=flat-square)](https://api.jinbaoai.top/downloads/jinbao/v0.2.17/jinbao-desktop-windows.zip)
[![Stars](https://img.shields.io/github/stars/YuanCao1996/dsh-game-jinbao?style=flat-square&color=e3b341)](https://github.com/YuanCao1996/dsh-game-jinbao/stargazers)

[下载](#-快速开始) · [它长什么样](#-它长什么样) · [怎么工作](#-它怎么工作) · [常见问题](#-常见问题)

<sub>中文 | <a href="#english">English</a></sub>

</div>

---

## 它解决什么问题

大部分「游戏助手」给你的是一堆数字：胜率、排行、出装表。但你真正卡住的时候想知道的是——

- **刚才那波为什么输？** 是对面刺客绕后，还是我站位太靠前？
- **这 1200 金币现在买什么？** 对面两个法伤，我该补斗篷还是先做核心装？
- **这个海克斯选哪个？** 它跟我已经拿到的三个强化到底协不协同？

金宝读你本机的游戏日志（击杀、装备、强化、阶段），在**悬浮窗里用一两句话回答这些**，并且只在真的有变化时开口。

<table>
<tr>
<td width="50%"><img src="tools/dsh-onboarding/welcome/augments.gif" alt="海克斯三选一推荐"><br><sub><b>海克斯三选一</b> · 按英雄适配排名，结合已选强化说协同</sub></td>
<td width="50%"><img src="tools/dsh-onboarding/welcome/players.gif" alt="双方阵容与胜率"><br><sub><b>双方阵容</b> · 样本胜率与最大威胁，不是官方战绩</sub></td>
</tr>
</table>

## 它长什么样

它不是一个网页后台，而是贴着游戏窗口的一条悬浮窗。四种形态，随时收起：

<table>
<tr>
<td width="33%"><img src="tools/dsh-onboarding/welcome/overlay-modes.png" alt="悬浮窗形态"><br><sub><b>四种形态</b>：大框 / 窄条 / 字幕 / 小球</sub></td>
<td width="33%"><img src="tools/dsh-onboarding/welcome/collapsed.png" alt="收起态"><br><sub><b>一键收起</b>，不挡视野，点击展开</sub></td>
<td width="33%"><img src="tools/dsh-onboarding/welcome/settings.png" alt="设置页"><br><sub><b>设置页</b>：语音、角色、模型、诊断</sub></td>
</tr>
</table>

> **探索图鉴**：每打完一局，会在这台电脑上记一条回忆 —— 用了哪个英雄、KDA、胜负、这局拿了什么海克斯、有没有三杀团灭。图鉴里按时间线排成一条「回忆画廊」，越打越长。

## ✨ 主要特性

| | 能力 | 说明 |
|:--|:--|:--|
| 🎯 | **实时战况建议** | 阵亡、破塔、团灭、拿龙、强化变化时才触发；一句一个动作，不复述面板 |
| 🛒 | **出装结合已选强化** | 「钢化你心」要求持有心之钢、「命运之武器」作用于第一件传说装 —— 强化点名的装备会排进六件顺序 |
| 🎲 | **海克斯三选一** | 按英雄适配排名给首选与备选；判不清时弹确认面板，**绝不猜一个记进本局** |
| 🗣️ | **语音播报 + 四条导师语气** | 金宝 / 柳如风 / 王霸天 / 铁汁，沿用 App 同款音色；也可只用字幕 |
| 🧠 | **可换模型** | 默认官方云端；也能填自己的 API Key（本机加密保存，不发给金宝服务器） |
| 📖 | **会记住你的偏好** | 说「记住，我更喜欢前排」，跨对局保留；可查询、可删除 |
| 🕹️ | **不止英雄联盟** | 王者荣耀日志、以及任意游戏窗口观察；身份不确定时保持「待核实」 |
| 🔒 | **日志只在本机** | 对局数据不上传、不参与排行榜；诊断导出不含聊天正文、玩家名、凭据、截图 |

## 🚀 快速开始

**方式一：下载即用（推荐）**

1. 下载并完整解压：[`jinbao-desktop-windows.zip`](https://api.jinbaoai.top/downloads/jinbao/v0.2.17/jinbao-desktop-windows.zip)（约 48 MB）
2. 双击 `开始使用.cmd`（或 `jinbao.exe`）
3. 悬浮窗与设置页自动打开 → 进游戏，剩下的交给它

不需要安装 Node，也不需要装 DSH Desktop。默认走官方云端服务，会自动尝试免登录体验名额，额度不足时用邮箱登录。

**方式二：从源码跑**

```powershell
git clone https://github.com/YuanCao1996/dsh-game-jinbao.git
cd dsh-game-jinbao
npm ci --ignore-scripts --legacy-peer-deps
node tools/cloud-desktop/main.mjs --state "$HOME/.jinbao-cloud-preview" --collect --coach
```

也可以作为 DSH 插件运行，详见 [QUICKSTART](docs/QUICKSTART.md) 与 [独立桌面版说明](docs/STANDALONE_DESKTOP.md)。

> 更新走独立签名通道：设置页可检查更新，**对局中不会安装**；校验失败继续用旧版本。

## 🔧 它怎么工作

```text
游戏客户端
   │  日志 / LCU 事件
   ▼
采集层  lol-companion ──► 对局事实（击杀、装备、强化、阶段、时间）
   │
   ▼
教练层  coach-server ──► 选择播报时机 → 组装事实与规则 → 调模型 → 约束输出
   │
   ▼
呈现层  overlay（WPF）──► 战况 / 字幕 / 语音 + 探索图鉴
```

三条设计原则，写在代码里的：

1. **只从已记录的事实推导** —— 不知道就说「未确认」，不编造
2. **有节流** —— 同一件事不重复说第二遍，安静比啰嗦值钱
3. **不新增无谓调用** —— 拟人化不靠多调一次模型

## ❓ 常见问题

<details>
<summary><b>会不会影响游戏帧数 / 被反作弊判定？</b></summary>

不注入游戏进程、不读写游戏内存、不改客户端文件。它只读客户端自己产生的日志与 LCU 接口，和 Overwolf 一类工具走的是同一层公开数据。
</details>

<details>
<summary><b>我的数据会被上传吗？</b></summary>

对局日志、探索记录、偏好都存在 `%USERPROFILE%\.jinbao-cloud-preview\`，不上传、不参与排行榜。导出诊断前会脱敏：不含聊天正文、玩家名、凭据、截图。
</details>

<details>
<summary><b>只有海克斯大乱斗能用吗？</b></summary>

英雄联盟的重点适配是海克斯大乱斗，普通模式也能用；王者荣耀读本机日志；其他游戏可以选一个窗口让它观察，但**未知游戏不套用 LoL 规则**，身份不确定时保持待核实。
</details>

<details>
<summary><b>它和那些数据网站的区别？</b></summary>

数据网站回答「这个英雄胜率多少」，金宝回答「**你这局现在该怎么办**」。它不做概率预测，也不把样本胜率说成本局胜率。
</details>

## 🙋 参与 / 反馈

- 遇到 bug 或建议：提 [Issue](https://github.com/YuanCao1996/dsh-game-jinbao/issues)，带上设置页导出的诊断包（脱敏）
- 想看开发细节：[DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 想看设计与踩坑（英文技术报告）：[TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md)
- 想看系统全景（8 张 Mermaid 图 + 22 张表）：[ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全策略：[SECURITY.md](SECURITY.md)

如果它让你少送了一波、或者某个瞬间觉得「这玩意儿真懂」，**点个 Star 就是最好的反馈** ⭐

<div align="center"><sub>MIT License · 免费使用 · 对局数据留在你自己电脑上</sub></div>

---

<a id="english"></a>

## English

**Jinbao** is a desktop game coach for Windows. It reads your local game logs and answers the questions you actually have mid-match — *who to focus this fight, which item to buy right now, whether this augment fits the three you already own* — as one or two sentences in a floating overlay, and stays quiet when nothing changed.

- **League of Legends** (Arena / Hextech ARAM focus), **Honor of Kings** logs, plus generic window observation
- Augment-aware build planning, augment pick ranking, voice coaching with four mentor voices
- Local-first: match data never leaves your machine
- Download: [`jinbao-desktop-windows.zip`](https://api.jinbaoai.top/downloads/jinbao/v0.2.17/jinbao-desktop-windows.zip) · MIT licensed
- **Technical report**: [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md) — why augment OCR needs confirmation instead of guessing, and the three failure modes that shaped the design
- **Architecture map**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 8 diagrams (system context, advice turn, augment state machine, update integrity) + 22 tables

<sub>Built on the DSH agent runtime. Documentation is in Chinese for now — issues in English are welcome.</sub>
