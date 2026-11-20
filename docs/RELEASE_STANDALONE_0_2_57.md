# 独立桌面版 0.2.57

发布：2026-11-20 23:1x（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.57`（包内 `0.2.57-standalone-preview.1`）

## 本次内容

把这一轮形象层的改动正式发出来：

- **局外全身形象改为 210px 高清素材**：从 600px 渲染图降到 210 并轻度锐化，WPF 端 1:1 显示，
  不再放大糊图；窗口 410×232，局内头肩尺寸（44/56/72/88）不变。
- **局外全身 / 局内头肩自动切换**：按 LCU 阶段判定，大厅、选人、结算后显示全身；
  InProgress / GameStart / Reconnect 显示头肩；切换时重载帧集合并归零下标。
- **去抖**：全身待机 36 帧 / 24fps，逐帧按 alpha 质心对齐、不再做三帧平均；呼吸动画对
  ≥200px 的形象压到约 2px 幅度，小图标保持 3%。
- 气泡（字幕条）高度仍只由文字决定，形象变化不会把条子撑粗。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,988,850` 字节，sha256 `bc9697086d915630403a8adc298892ce23879e16c1bb7adc39cab116a11fd375` |
| manifest sha256 | `317baeedc5be9add1939f51c38e12f223cd4225eeda87f1d9aa96d5fe5159855` |
| 应用层 zip | `7,907,360` 字节，sha256 `2b3b16de4861ad4044267e8f1e1762e318fa749d9e0e6ed2587aadf7f1deba2d` |
| 运行时 base | `runtime/node.exe` 93,915,464 字节（与 0.2.56 相同，走硬链接，不重复下载） |
| 构建 | 干净 `git worktree`（HEAD `14de749`），Node 24.22.1（安装包内运行时），`JINBAO_SKIP_SHORTCUT=1` |

## 发布步骤（复现用）

1. 干净 worktree 里把 `build-preview.mjs` 的 `updateVersion` 改成 `0.2.57`；
2. `node tools/cloud-desktop/build-preview.mjs <out>`；
3. `node tools/desktop-release/package-release.mjs <out> <dist>`；
4. 上传两个 zip 到 `/var/lib/jinbao-independent-downloads/v0.2.57/`，写 `SHA256SUMS.txt`；
5. 在 `/etc/jinbao-desktop/downloads.conf` 追加 v0.2.57 的 3 个 location 并 `nginx -s reload`；
6. 用 `/etc/jinbao-desktop/update-signing.pem` 签 payload，替换 `latest.json`（旧文件已备份为
   `latest.json.bak-20261120230755`）。

## 验证

- `verifyPackage` 本地通过（539 个文件，清单哈希一致）；
- feed 用 `update-public.pem` 验签通过：0.2.57 / 42,988,850 / app 7,907,360；
- 两个 zip 与 SHA256SUMS 的 HEAD 长度、哈希一致；
- 真机 0.2.56 → 0.2.57：应用层增量下载 7.9MB、约 17 秒，校验后自动重启，
  `launcher-state` 变为 `0.2.57-standalone-preview.1`，悬浮窗从 `releases\v0.2.57` 启动，
  窗口 410×232，全身 210px 正常显示。

## 已知遗留

- 全身素材仍来自 1280×720 绿幕视频（角色约 560px），210px 显示是清晰度与尺寸的折中；
  要更大更清晰需要 1080p/2K 源素材重跑 character-pipeline。
- 说话（talk）动画为 24fps、24 帧；如果觉得动作不够顺，后续可以补到 48 帧。
