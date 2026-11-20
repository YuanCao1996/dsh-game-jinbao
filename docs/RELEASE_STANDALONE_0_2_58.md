# 独立桌面版 0.2.58

发布：2026-11-20 23:3x（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.58`（包内 `0.2.58-standalone-preview.1`）

## 这一版在修什么

0.2.57 引入了一个**字幕不可见**的回归：

- 为了让形象不撑粗条子，0.2.57 把 `NarrowBubble` 改成了垂直居中；
- 但 `NarrowCanvas` 的期望高度本来就是 0（以前靠 Border 拉伸才拿到高度），居中后
  Border 只剩 padding，文字被 `ClipToBounds` 整段裁掉——表现就是「条子里看不到文字」。

修法：`Set-NarrowMetrics` 里显式设置 Canvas 高度（字幕模式 2 行、跑马灯 1 行），
气泡按文字高度居中。同时全身模式条子加宽：

| | 0.2.57 | 0.2.58 |
|---|---|---|
| 全身模式条子宽度 | 410（文字约 200px） | **510（文字约 300px）** |
| 局内头肩 | 按用户宽度 300 | 不变 |
| 字幕显示 | 被裁剪 ❌ | 正常 ✅ |

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `42,988,979` 字节，sha256 `6803415c5b17cd69673f51bb635705452b868dc6c401d4f63b30edd532b78cf9` |
| manifest sha256 | `16bc16fd31030469149db9ebbb73beb73f6ccdde023d0a6b2fe6261b7e557613` |
| 应用层 zip | `7,907,489` 字节，sha256 `c7fad9e4988c94540b3f2e24642f249930b424d3b1390cac92a41078d753a0e8` |
| 构建 | 干净 worktree（HEAD `40c680a`），Node 24.22.1（包内运行时） |

## 发布与验证

1. 构建、打包（`package-release.mjs`）；
2. 上传到 `/var/lib/jinbao-independent-downloads/v0.2.58/`，生成 `SHA256SUMS.txt`；
3. `/etc/jinbao-desktop/downloads.conf` 追加 v0.2.58 的 3 个 location，`nginx -s reload`；
4. 用 `/etc/jinbao-desktop/update-signing.pem` 签名，替换 `latest.json`
   （旧文件备份为 `latest.json.bak-20261120233307`）；
5. feed 验签通过：0.2.58 / 42,988,979 / app 7,907,489；两个 zip HEAD 200，长度一致。

## 真机

- 发布时用户正在对局（`InProgress`，09:50），**没有强制重启**；
- 运行中的 0.2.57 已现场打补丁并验证：字幕恢复显示（截图可见「复活后先补长剑补满穿甲线吧。」），
  气泡高度正常；
- 0.2.58 会后台下载，下次启动或对局结束后在设置页安装即可。

## 回滚

`/var/lib/jinbao-independent-downloads/latest.json.bak-20261120233307` 为 0.2.57 的 feed。
