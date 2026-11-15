# 独立桌面版 0.2.34 预览

发布：2026-11-15 22:0x（CST）
通道：independent standalone（`https://api.jinbaoai.top/downloads/jinbao/latest.json`）
版本：`0.2.34`（包内 `0.2.34-standalone-preview.1`）

## 产物

| 项 | 值 |
|---|---|
| zip | `/var/lib/jinbao-independent-downloads/v0.2.34/jinbao-desktop-windows.zip` |
| 大小 | 50,768,188 字节（48.4 MB） |
| sha256 | `d1c931c4537243ceeb3fd1cc25e54fe8ebd79bfa13f39e41231bbef52ee323f4` |
| manifest.json sha256 | `9e3a595498e9a9196a792de75d05dd90fc5de9f156aafd0250113088b15128ca` |
| 本地同包 | `C:\Users\Administrator\jinbao-0252`、`deliverables\jinbao-cloud-preview-0.2.34-20261115.zip` |

## 本次内容

- 聊天识别：游戏内聊天框（队友打字、信号、购买、海克斯）接入；解析前按本局名单纠错（玩家/英雄/装备/海克斯名），
  解析后再纠字段；认不出的直接丢。识别结果只进智能体动态（8 秒最多一条），不上聊天时间线；
  设置页显示聊天识别状态，聊天框未展开时给出提示。
- 悬浮窗：设置页可配鼠标穿透；双击顶栏收起、双击窄条展开；收起背景 95%→45%；去掉「金宝待命中」占位。
- 播报：第一次阵亡不播；人数清点类（我方 N 人已就位）不播；未核实信息不播；装备价格与海克斯效果提前注入
  （装备回合检索率 94%→46%，回合耗时中位 35.2s→31.6s）。
- 采集：时钟瞬断不再把一局拆成两局；客户端断流两分钟自动收尾（中性结束语）；GameEnd 立刻置为已结束。

## 发布流程（复现）

1. `node tools/cloud-desktop/build-preview.mjs <outdir>` 构建；
2. 上传 zip 到 `/var/lib/jinbao-independent-downloads/v<版本>/jinbao-desktop-windows.zip`；
3. 取 `manifest.json` 的 sha256 与 zip 的 sha256、字节数，拼 payload（`runtime/version/url/bytes/sha256/manifestSha256/notes`）；
4. 用 `/etc/jinbao-desktop/update-signing.pem` 以 Ed25519 签名（Node `crypto.sign`，OpenSSL 1.1.1 不支持 `-rawin`）；
5. 写 `latest.json`（`{payload, signature}`），旧文件已备份为 `latest.json.bak-*`；
6. `/etc/jinbao-desktop/downloads.conf` 追加该版本的 zip 与 SHA256SUMS 的 location，`nginx -t && systemctl reload nginx`；
7. 用 `verifyRelease()` + 公钥验证 feed，`HEAD` 校验 zip 可达。

## 验证结果

```
feed HTTP 200            version 0.2.34  runtime standalone
bytes 50768188           与 zip 实际大小一致
sha256 / manifestSha256  与服务器计算值一致
zip HTTP 200             content-length 50768188
应用内检查更新           state=current, "已是最新版本 0.2.34"
```