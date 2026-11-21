# 独立桌面版 0.2.73

发布：2026-11-21 21:4x（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.73`（包内 `0.2.73-standalone-preview.1`）

## 本次内容

把 Codex 的弹幕修复正式合入主干并发布（提交 `0792e97`）：

- **弹幕断线自动重连**：`reconnecting` 状态 + 指数退避（2s 起、上限 30s），
  静默认证超时、stop 后不会被迟到的 HTTP 结果重新拉起；
- **观众链路**：`viewer_message` / `viewer_reply` 进聊天时间线并生成「回应观众」播报，
  观众消息不进入个人记忆；
- **viewerFacts**：观众应答只暴露英雄/装备/强化等公开信息，不带账号身份；
- **settings-link 写入容错**：缓存链接写失败不再影响设置服务；
- 测试：danmaku-connection / stream-end-to-end / viewer-routing / settings-link
  **12/12**，viewer-labels 回归 3 例，脚本编码 **52/52**。

同时包含前两版已提交但未发布的内容：

- 探索图鉴：详情/图片/批注补 setup nonce，高光图改 blob 并放行 CSP；
- 回忆画廊点某一局直接进详情（不再先弹侧边栏）；
- 高光截图只留我方（Codex 的 highlightSide/shouldCapture）；
- 字幕条空闲收起、只显示形象并**贴屏幕最右**，有消息淡入弹出、播完自动收起。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,939,654` 字节，sha256 `9f23ee6b1e2469db32cc9c288d588cd3913faeae4f3626bdf3442a42a43479f5` |
| manifest sha256 | `918ae1719ea199bef9743b776270b0b04fcd78583caf85f7d77022a88a35e856` |
| 应用层 zip | `7,858,164` 字节，sha256 `ce8a5351b7e760b2226be81768dfe731f5578ec018c0cba66800fb2921708906` |
| 构建 | 干净 worktree（HEAD `0792e97`），Node 24.22.1（包内运行时） |

## 发布

1. 上传到 `/var/lib/jinbao-independent-downloads/v0.2.73/`，生成 `SHA256SUMS.txt`；
2. `/etc/jinbao-desktop/downloads.conf` 追加 v0.2.73 的 3 个 location，`nginx -s reload`；
3. 用 `/etc/jinbao-desktop/update-signing.pem` 签名，替换 `latest.json`
   （备份 `latest.json.bak-202611212137xx`）；
4. feed 验签通过，两个 zip HEAD 200、长度一致。

## 真机

- 本机从 0.2.72 升到 **0.2.73**（干净构建，不再依赖临时拼装）；
- 设置页 200，弹幕房间 2948407 `authorized`；
- 悬浮窗空闲 `126×232 @ (1794,322)`（贴右、只显示形象）。

## 过程备注

- 升级时启动器进程不在（热修复结束后应用是由入口直接拉起），`apply-status` 卡在
  `applying`。已清理该状态并从桌面快捷方式重启，启动器按已下载的 0.2.73 完成切换。
- 以后升级请确保金宝是通过 `jinbao.exe` 启动器启动的，否则“立即安装”只会停在 applying。

## 回滚

`latest.json.bak-*`（发布前备份）指向 0.2.72；把该文件放回 `latest.json` 即可回退。
