# 屏幕文字识别：Windows OCR vs PP-OCRv6（本机实测）

2026-11-16。目的：回答「当前屏幕上的字该用哪套 OCR」。所有数字都是本机 CPU 实测，样本为真实对局帧。

## 结论

1. **大号描边标题（海克斯卡名）两者一样准**：12 张真实卡面 36 个卡名，两边都把标题读对了。严格逐字相等计分时各有 1 处卡边数字被粘进标题（Windows 是「炼狱龙魂1」，PP-OCRv6 medium 是「残忍1」），PP tiny/small 另有 1 处把「奥」读成「奧」的异体字。
2. **速度差一到两个数量级**：同一张 1956×238 卡面，Windows OCR 中位 29 ms，PP-OCRv6 tiny 432 ms、small 1138 ms、medium 5052 ms。
3. **整屏 1920×1080**：Windows 171–238 ms；PP-OCRv6 tiny 2.9–3.8 s；medium 34–38 s（不可用于实时）。
4. **小号彩色聊天字两者都不可靠**：Windows 整屏读成乱码（放大 2×/3× 也一样）；PP-OCRv6 tiny 能读出约一半（「00:51 Noble…Faker」「他们放倒倒倒」「秘术冲拳」，置信度 0.79–0.99，但人名和括号仍是碎字）。
5. **运行时继续用 Windows OCR**：零依赖、秒级以内、卡名不输；PP-OCRv6 只适合离线标注或低频慢车道校验。

## 测试方法

- 数据：`%USERPROFILE%\.jinbao-cloud-preview\card-watch-*-undecided-panel-closed\baseline.png`，共 20 张 1956×238 卡面条；其中 12 张确实是三张海克斯卡标题（其余是商城/计分板误截），由人工逐张核对出 36 个卡名作为答案。
- 整屏：`%USERPROFILE%\.jinbao-cloud-preview\highlights\<match>.jsonl\*.jpg`，1920×1080 真实对局帧（首杀/团灭横幅 + 聊天 + HUD）。
- Windows OCR：`C:\Users\Administrator\ocr-bench\winocr.ps1`，直接调 `Windows.Media.Ocr`（zh-Hans），取 `RecognizeAsync` 的单次耗时。生产路径同样是这个引擎（`tools/lol-companion/capture-augments.ps1`）。
- PP-OCRv6：`D:\work\DSH\publish\jinbao-testkit\ocr\ocr-service.py`（paddleocr 3.7.0 + paddlepaddle 3.3.1，CPU，`enable_mkldnn=False`），HTTP 服务 warm 后取 3 次最小值。
- 计分：按卡位 x 区间把 OCR 行合并成三列，去空白/标点后与人工答案逐字相等才算对。

## 结果

### 卡面标题（12 张 / 36 个卡名）

| 引擎 | 严格相等 | 标题正确 | 中位耗时 | 最大耗时 | 备注 |
|---|---|---|---|---|---|
| Windows.Media.Ocr (zh-Hans) | 35/36 | 36/36 | **29 ms** | 38 ms | 无置信度，只有包围盒 |
| PP-OCRv6 tiny | 35/36 | 35/36 | 432 ms | 471 ms | 「奥术公理」→「奧术公理」 |
| PP-OCRv6 small | 34/36 | 35/36 | 1138 ms | 1374 ms | 异体字 + 1 处粘连 |
| PP-OCRv6 medium | 35/36 | 36/36 | 5052 ms | 5704 ms | 有逐行置信度（0.999） |

### 整屏 1920×1080（首杀帧）

| 引擎 | 耗时 | 行数 | 首杀横幅 | HUD 数字 | 聊天行 |
|---|---|---|---|---|---|
| Windows OCR | 187 ms | 25 | ✅ 第一滴血！ | 碎裂（「107 0」「/ 0 / 0 ／ 0」） | ❌ 乱码 |
| PP-OCRv6 tiny | 3752 ms | 59 | ✅ 第一滴血！ | 基本正确（0/0/0、399/1101、FPS:111） | 一半（0.82） |
| PP-OCRv6 medium | 38191 ms | 60 | ✅ | 基本正确 | 一半 |

整屏里把聊天区裁成 1000×80 再交给 PP-OCRv6 tiny：warm 270–282 ms，仍只能读出碎片（人名/括号碎、置信度 0.40–0.54 的垃圾行），说明瓶颈是字体与描边，不是分辨率。

### 资源与部署

| 项目 | Windows OCR | PP-OCRv6 |
|---|---|---|
| 依赖 | 系统自带（需中文 OCR 语言包） | Python 3.12 venv 0.82 GB / 25,992 文件 + 模型 169 MB |
| 常驻内存 | worker 进程约 85 MB | tiny 230 MB / medium 425 MB |
| 冷启动 | 约 0.6–0.9 s（进程 + 引擎） | 3.7 s（模型已缓存，`--preload`） |
| 输出 | 文本 + 包围盒 | 文本 + 包围盒 + 逐行置信度 |
| GPU | 不需要 | 本机有 RTX 4060 Ti，但未装 paddle-gpu，未测 |

## 建议

1. 运行时保持 Windows OCR：卡名识别不输 PP-OCRv6，速度快 15–170 倍，且不需要额外运行时。
2. 想提升聊天识别，换引擎不是第一步：现状「裁剪 + 名单纠错 + 认不出就丢」比换引擎更划算；确实要补，可加一条低频慢车道（聊天裁剪 → PP-OCRv6 tiny，约 0.27 s/帧、230 MB、需 Python 栈），按 10–20 秒一次调用，不放进每帧循环。
3. PP-OCRv6 medium 只适合离线：例如给回归集打标、或夜间批量核对（5 s/卡面、38 s/整屏）。
4. 若未来要评估 GPU 版本，需要单独安装 paddlepaddle-gpu 并复测；面向用户的发行包不能假设有独显。

## 局限

- 样本量 12 张卡面 + 3 张整屏，够做方向判断，不够做置信区间。
- 只在 CPU 上比；GPU 未测。
- 整屏没有逐字人工标注，只有人工对照的定性结论（横幅/HUD/聊天三类）。
- PP-OCRv6 的 `mkldnn` 因 paddlepaddle 3.3.1 的 oneDNN 缺陷必须关闭，这本身也压低了它的 CPU 速度；换版本可能缩小差距，但不会到 Windows OCR 的量级。
