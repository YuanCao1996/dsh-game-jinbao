# 教练变慢的根因与修复（2026-11-19）

## 现象

昨晚 271 次 agent 请求：p50 18.5s、p90 48.3s、最长 60.6s；出装类 p50 **47.7s**；
13 次「对局中超过 120 秒没有任何建议」；3 次任务失败（2×任务超时、1×模型返回不可解析）。

拆时间：排队 1ms、工具 1ms、思考 6.3s、**出答案 17.7s（p90 33.7s）**。

## 根因：输出预算全被「思考」吃掉了

对上游 `deepseek-v4.1-flash`（opencode go 通道）做直接探测：

| 请求 | 结果 |
|---|---|
| `max_tokens: 300`，默认 | `completion_tokens: 300`，`finish: length`，**正文为空**，只有 reasoning |
| `reasoning_effort: low / minimal` | 无变化（该通道不认这个参数） |
| `enable_thinking: false` | 无变化 |
| **`thinking: { type: 'disabled' }`** | 正常出正文，56 tokens |

也就是说：模型把整段输出预算花在思考上，正文要等思考结束才吐；流式输出里前几百个 SSE 帧全是
`reasoning_content`，`content` 一帧都没有。客户端一直等正文，于是表现为「想很久才说话」。

## 改在哪一层

第一次改错了：`runtime-desktop/models/upstream.mjs` 是**公共模型代理**，桌面 agent 不走它
（桌面 agent 由 `runtime-backend/agent_dsh` 直接连上游）。已还原。

真正的位置是 `runtime-backend/agent_dsh/model_transport.py`：

```python
if go:
    # 这个 provider 只认 thinking.type=disabled；enable_thinking/reasoning_effort 都被忽略。
    payload['thinking'] = {'type': 'disabled'}
    payload.pop('stream_options', None)
```

流式本来就是通的（`runner.py` → `on_text` → `public_text`），所以关掉思考后正文会立刻开始流。

## 实测

用改后的 transport 直接打上游（同样的真实问题）：

```
首段正文 3615ms   总耗时 4532ms   无 reasoning   正文「900块优先出提亚马特清线压制，塞拉斯偷你大招没用的。」
```

对比：修改前同规模请求出答案 p50 **17.7s**。

## 部署与验证

- 已重启 `jinbao-dsh-desktop-preview`（agent host），`jinbao-desktop-agent-preview` 健康；
- 已发布桌面版 **0.2.49**（另含提示词收敛：告知模型当前局势已在上下文，不要反复调
  `get_current_match_state`——昨晚该工具被调 80 次、`search_local_knowledge` 42 次）；
- 待真实对局验收：看下一次 `diagnostics` 里的 agent 耗时分布与 `advice_wait_long` 次数。

## 顺带确认

- **上下文瘦身没有做**：事件窗口本来就有上限（20 条 / 16KB），再砍收益很小，风险是丢信息；
- **出装规则快通道 / 结果缓存**：按要求不做；
- 风险：关掉思考可能降低复杂局面的推理质量，需要实战观察；若明显变差，可只对复杂询问开思考。
