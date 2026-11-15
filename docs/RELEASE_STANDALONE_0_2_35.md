# 独立桌面版 0.2.35

发布：2026-11-15 23:18（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.35`（包内 `0.2.35-standalone-preview.1`）

## 本次内容

- **更新只下应用层**：发布包里 90MB 的 `runtime/node.exe` 跨版本不变，更新时不再重下，
  而是把当前安装里那份硬链接到新版本目录（同卷不占额外空间，链接失败退回复制）。
  更新包体 39.2MB → 6.0MB，实测线上 14 秒装好（原来约 100 秒）。
  0.2.34 及更早的客户端不认这一层，从 0.2.34 升上来这一次仍是全量包，之后再升就是 6MB。
- **下载更稳**：断点续传（`Range`）+ 30 秒无数据自动重连，仍按 3 次尝试上限。
- **包体瘦身**：英雄头像 380px → 128px（页面按 44/64px 显示）、主图标 1254px → 256px，
  图片总计 10.40MB → 1.03MB，安装包 48.4MB → 39.2MB。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `/var/lib/jinbao-independent-downloads/v0.2.35/jinbao-desktop-windows.zip` |
| 全量大小 | 41,088,179 字节（39.18 MB） |
| 全量 sha256 | `c9afc9f1f5fa84a68a3fe9b3bf7d55dca92970254bcb3302d511ae15b4634141` |
| manifest.json sha256 | `220191c60a2020b208f3bab7bc423fe9f370a4a250ad086f618175719032f9d1` |
| 应用层 zip | `/var/lib/jinbao-independent-downloads/v0.2.35/jinbao-desktop-windows-app.zip` |
| 应用层大小 | 6,006,689 字节（5.73 MB） |
| 应用层 sha256 | `0955b4904ad2fbe984e7713633eddda93ee61469730bb38337a493bb438fe1c1` |
| 运行时 | `runtime/node.exe` 93,915,464 字节，sha256 `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5` |
| 本地同包 | `C:\Users\Administrator\jinbao-0256` |
| 交付目录 | `C:\Users\Administrator\jinbao-deliver\0.2.35`（两个 zip + `feed-fields.json` + `payload.json`） |

## 发布流程（复现）

1. `node tools/cloud-desktop/build-preview.mjs <outdir>` 构建；
2. `node tools/desktop-release/package-release.mjs <outdir> <交付目录>` 一次产出全量包与应用层包，
   并把 `bytes/sha256/manifestSha256/app{...}` 写进 `feed-fields.json`（压缩用 .NET optimal，
   比 Node 自带 deflate 在 node.exe 上小 0.9MB；条目名统一 `/`，否则安装器按不安全路径拒绝）；
3. 用 `feed-fields.json` 拼 payload（含 `app.url/bytes/sha256/base`），
   用 `/etc/jinbao-desktop/update-signing.pem` 签（服务器无 Node，改 `python3` + `cryptography` 的 Ed25519）；
4. 上传两个 zip，`sha256sum *.zip > SHA256SUMS.txt`；
5. `downloads.conf` 追加三处 location（两个 zip + SHA256SUMS），`nginx -t && systemctl reload nginx`；
6. 备份并替换 `latest.json`；
7. 校验：feed 验签（新老两版校验器）、两个 zip 的 `HEAD` 与 `Range`、真实环境跑一次应用层更新。

## 验证结果

```
feed 验签通过            0.2.35  bytes 41088179  app 6006689
0.2.34 老校验器          接受同一 feed（忽略 app 字段），仍按全量包更新
全量 HEAD 200            41088179（与声明一致）  Range 206 accept-ranges bytes
应用层 HEAD 200          6006689（与声明一致）   Range 206 accept-ranges bytes
真实应用层更新           14.2 秒完成，state=ready，465 个文件，
                         runtime/node.exe 与旧安装 inode 相同（硬链接，未复制）
本机运行时不一致时       自动退回全量包（单测覆盖）
应用层包被篡改           校验失败，不换版本（单测覆盖）
```
