# 独立桌面版 0.2.36

发布：2026-11-17 00:08（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.36`（包内 `0.2.36-standalone-preview.1`）

## 本次内容

**新增「金宝日记」**（设置页侧栏 → 金宝日记，独立页面 `/diary`）。

- **她自己决定写不写**：一天最多一篇，也可能整天不写；凌晨 04:00 换日，跨午夜的局算前一天。
  分数由当天真实发生的事决定（局数、你在游戏里自己打的字、高光、建议被撤回、隔了几天），
  同一份数据算出来的结果永远一致——不会一天写两篇，也不会反复重写。
- **只写当天真发生的事**：对局、你打过的字、她给过又被撤回的建议、她自己的播报；没素材就不写、不编。
- **写法每天不一样**：便签 / 一口气 / 碎句子 / 写到一半停住；口吻跟随设置里的角色（金宝、柳如风、王霸天、铁汁）。
- **允许涂改**（删除线）与跨天回指（"上次那盏灯笼"），也允许半句、括号补一句。
- **会闹情绪**：2–3 天撒娇、4–7 天抱怨数日子、8–14 天委屈、更久会难过；不指责、不威胁、不催上线。
- **节日写信**（一天一封，9 点后）、**周日回顾**（这周有 3 天对局才写，样本够才说规律）。
- **惦记的事**（未了线：日记里那句话 + 你说的"明天/下次…"）一周自然提两次。
- **每周挑一次网上在传的说法**，能贴就用、贴不上就不用。
- 日记、热梗、未了线都只存本机，不上传。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `/var/lib/jinbao-independent-downloads/v0.2.36/jinbao-desktop-windows.zip` |
| 全量大小 | 41,136,125 字节（39.23 MB） |
| 全量 sha256 | `3b591f93bdfbd7e7e9ffb3b335b0864cb6c04e5d11de8ad536e71526e3bde92a` |
| manifest.json sha256 | `7da729a9cdd4de512148282cd3098f0b1db835d5f4f8a98a1de319a1e9a829f5` |
| 应用层 zip | 6,054,635 字节（5.77 MB） |
| 应用层 sha256 | `38bae9eabc674508ceec2d70a886888c79f04484fe09f58cdd818b4e664e6e4d` |
| 运行时 | `runtime/node.exe` 93,915,464 字节，sha256 `d702daa8…240e5`（与 0.2.35 相同，可走应用层更新） |
| 本地同包 | `C:\Users\Administrator\jinbao-0257` |
| 交付目录 | `C:\Users\Administrator\jinbao-deliver\0.2.36` |

## 发布流程

1. `node tools/cloud-desktop/build-preview.mjs <outdir>` 构建；
   **注意**：`diary.html` 必须在 `build-preview.mjs` 的显式清单里，否则页面 404/断连（本次烟测抓到过一次）。
2. `node tools/desktop-release/package-release.mjs <outdir> <交付目录>` 出全量包与应用层包；
3. 拼 payload（含 `app.url/bytes/sha256/base`），服务器上 `python3 + cryptography` 签名；
4. 上传两个 zip，`sha256sum *.zip > SHA256SUMS.txt`；
5. `downloads.conf` 追加三处 location，`nginx -t && systemctl reload nginx`；
6. 备份并替换 `latest.json`。

## 验证结果

```
feed 验签通过            0.2.36  bytes 41,136,125  app 6,054,635
全量 HEAD 200            41,136,125（一致）  Range 206
应用层 HEAD 200          6,054,635（一致）   Range 206
真机应用层更新           从 0.2.35 升级：14.7 秒完成，476 个文件，
                         runtime/node.exe 与旧安装 inode 相同（硬链接，未复制）
0.2.34 老客户端          接受同一 feed，仍走全量包
烟测（构建产物）         /diary 200、23,410 字节；/api/diary 与 on-this-day 正常
```

## 已知取舍

- 节气没做（日期逐年浮动，写错更假）；多稿取样、语音留言留到下一版。
- 热梗自动路径偏保守，多数周会挑不出东西——这是预期的「用不上就不带」；
  需要指定某周时写 `diary/trends-manual.json`。
