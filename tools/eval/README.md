# 模型评估集（画面识别 / 游戏理解 / 策略建议）

用于横向比较 **OpenCode Go** 各模型在本产品上的表现。评估对象是"模型能力"，不是产品代码质量——后者由 `tools/*/tests` 覆盖。

## 任务分类

| 任务 | 输入 | 输出 | 判定方式 |
|---|---|---|---|
| `augment-recognition` | 一张海克斯三选一截图 | 三个强化名称（左→右） | 与真值集合比对，可给部分分 |
| `hero-recognition` | 加载页/选人页截图 | 双方英雄列表 | 与真值集合比对，允许别名 |
| `strategy-advice` | 对局事实 + 问题 | 2–3 句可执行建议 | rubric 打分（人工或 judge），无唯一答案 |
| `scene-understanding` | 一张游戏内截图 | 阶段/比分/装备/威胁的结构化 JSON | 字段级比对 |

当前完成度：

| 任务 | 用例 | 真值来源 | 状态 |
|---|---|---|---|
| `augment-recognition` | **45**（4 轮 offer 全覆盖） | `augment-frames/_truth.json`（来自真实对局日志） | ✅ 可用 |
| `hero-recognition` | 1 seed | 人工读图标注 | ⏳ 需扩充 |
| `strategy-advice` | 0 | rubric，需人工校准 | ⏳ 待建 |
| `scene-understanding` | 0 | 需与日志配对 | ⏳ 待建 |

## 用例格式

```jsonc
{
  "id": "augment-20260930_214639_809",
  "task": "augment-recognition",
  "prompt": "读出海克斯三选一面板上的三个强化名称…",
  "image": { "path": "...png", "sha256": "...", "bytes": 2130376 },
  "ground_truth": { "options": ["终极唤醒","最终形态","史上最大雪球"], "roll": 1 },
  "meta": { "source": "augment-frames", "captured_at": "...", "offset_ms": 812, "sidecar": "_truth.json" },
  "scoring": { "type": "exact-set", "fields": ["options"], "partial_credit": true }
}
```

约定：

- **图片不入库**。用例只记绝对路径 + `sha256`，避免仓库膨胀；`sha256` 用于发现图片被替换。
- **真值来自日志或人工，绝不来自模型**。任何用模型生成的标注只能进 `draft/`，不得进 `cases/`。
- 需要人工确认的用例放 `cases/candidates.jsonl`，标 `"status": "unlabeled"`。

## 生成器

```bash
# 海克斯识别：从带真值的帧目录重建用例
node tools/eval/scripts/build-augment.mjs <帧目录> <输出jsonl>

# 候选采样：从未标注图库里抽样，供人工标注
node tools/eval/scripts/sample-candidates.mjs <图片目录> <数量> <输出jsonl>
```

## 模型清单（OpenCode Go）

据 OpenCode 官方文档（2026-11 抓取）当前提供 33 个模型，与本产品相关的候选：

| 类别 | 模型 | 备注 |
|---|---|---|
| 多模态（可看图） | Gemini 4 Argon、GPT 6 Luna、GPT 5.6 Luna、Claude Haiku 5.5、Grok 4.7 | 画面识别任务的主力候选 |
| 自研/国产 | DeepSeek V4.1 Flash（当前线上）、Qwen 三兄弟（3.8 Flash / 3.7 Plus / 4 Max） | 当前产品在用 DeepSeek |
| 编码向 | Kimi K3/K3.1、GLM 5.x、MiMo V2.x、MiniMax M3、LongCat 2.0、Step 5 | 游戏理解可做对照 |
| 免费档 | Beam Free、Iceman Contributor Free、LongCat 2.5 Free、Hy4 Flash Free | 成本对照 |

> 具体 ID 与端点见官方文档：<https://opencode.ai/docs/console/go/>

### ⚠️ 网关限制（评估前必须解决）

服务端 `agent_dsh/model_transport.py:32` 会校验：

```python
expected = "deepseek-v4.1-flash" if go else "qwen3.8-flash"
if payload.get("model") != expected: raise ValueError("invalid_model_payload")
```

即**经过我们云端网关时只允许一个模型**。要跑多模型对比，只有两条路：

1. **绕开网关**：用 OpenCode Go 的 API Key 直接调上游（评估专用，不进产品链路）；
2. **加白名单**：给评估环境放行模型列表（改动服务端，需部署窗口）。

建议走 1：评估是离线行为，不该让生产网关为它开口子。

## 评分

| 任务 | 规则 |
|---|---|
| 集合类（augment/hero） | 逐项比对，允许别名与顺序无关；部分分 = 命中数 / 总数 |
| rubric 类（strategy） | 四条 0–5 分：可执行、针对性强、证据一致、像人说话 |
| 字段类（scene） | 每字段独立比对，缺失记 0 |

**不要用单一总分横向排名**：不同模型擅长的任务不同，报告必须按任务分组。

## 反过拟合

- 用例按**对局**划分，不要按帧（同局帧高度相关）。
- 平衡改动后，旧用例标 `superseded`，不要删——保留历史可比性。
- 新增用例时同时报告"旧用例上的分数"，防止只在新数据上变好。

## 人工审核页

```bash
node tools/eval/review-server.mjs        # 默认 http://127.0.0.1:3099/
```

- 左侧看图（`Z` 缩放），右侧改标签；`←/→` 切换、`Ctrl+S` 保存、`X` 跳过。
- 顶部筛选：待标注 / 全部 / 按任务。
- 保存只改 `ground_truth / status / task / note` 四个字段，且原子重写单行。
- **安全边界**：只监听 `127.0.0.1`；`/img` 只放行已经出现在用例里的图片路径，`C:/Windows/win.ini` 这类越权读取返回 404（已测）。
- 每次保存会写入 `meta.reviewed_at` 与 `meta.note`，便于追溯"谁在什么时候改了什么"。

## 配对采集（解决"图与真相配不上"）

现有 1 万张截图没有对应日志，无法自动出真值。`pair-capture.mjs` 让**以后每一帧都自带真值**：

```js
import { savePair } from './tools/eval/pair-capture.mjs';

const result = savePair({
  dir: `${stateDir}/capture-pairs`,     // 由调用方决定，默认不落盘
  image: pngBuffer,
  facts: { game, match, gameSeconds, me, offers, champSelect },
  source: 'host',
});
// { written: true, png, json } | { written: false, reason: 'duplicate_frame' }
```

约束：

- 同内容帧按 `sha256` 去重，重复截屏不占空间。
- `facts` 必填且**原样保存**，模块不会补任何字段。
- 侧车带 `candidate_tasks` 提示（有 `offers` → 海克斯；有 `champSelect` → 英雄），人工确认后即可转成正式用例。
- **默认关闭**：截图可能含玩家昵称，落盘目录必须显式传入；生产环境上线前需要产品确认保留周期。

### 尚未接线的部分

**已决定：只在开发 / 内测环境开启（方案 A）。**

开关是进程级环境变量，默认关闭，不从 `NODE_ENV` 推断：

```powershell
$env:JINBAO_EVAL_CAPTURE='1'   # 仅内测包设置这一项
```

接线情况：

| 线 | 状态 | 位置 |
|---|---|---|
| 宿主内 | ✅ 已接线 | `dsh-coach-server/lib/screen-tool.js` → `inspect_latest_screen` 拍到有效帧时写入 |
| 独立版 | ❌ 未接线 | `cloud-desktop` 的采集路径尚未加钩子 |

已实现的安全约束：

- 关闭时**不创建任何文件**（有测试守护）。
- `captureFacts()` 只保留有界字段（局时、阶段、英雄、K/D/A、金币、强化列表），**不采集聊天与用户原话**。
- 同内容帧按 `sha256` 去重，重复截屏不占空间。
- 落盘目录固定为 `<状态目录>/capture-pairs`，删除该目录即清空。

内测包还需补一条清理策略（建议：7 天或 2GB 上限，取先到者），否则长期运行会持续增长。


