# 独立桌面版 0.3.61

发布：2026-11-27（CST）
通道：feed + 官网 + GitHub Releases
重点：增量更新上线并完成真实升级验证。

## 增量更新

- 发布包新增 `jinbao-desktop-windows-patch.zip`（本次 40,526 字节，约 40 KB）；
- feed 增加 `patch` 字段：`baseVersion`、`baseManifestSha256`、`url`、`bytes`、`sha256`；
- 更新器只有在本地版本等于基准版本、且本地 `manifest.json` 哈希匹配时才走补丁；
- 补丁流程：复制当前版本到 staging → 校验并覆盖变化文件 → 删除移除文件 → 用新 manifest 全量校验；
- 任一条件不满足自动回退应用层 zip / 全量 zip。

## 真实验证

- 本机 0.3.60 通过增量补丁升级到 0.3.61；
- 升级结果：`state=success`，`fromVersion=0.3.60`，`version=0.3.61`；
- 下载量约 40 KB，而不是应用层包 7.99 MB。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `43,078,642` 字节，sha256 `3338e52c16ca1ab8cd68826ea42f4dfcf7658fa6f8671951a51a727808b86e2d` |
| 应用层 zip | `7,997,152` 字节，sha256 `6e27f11ce538cb95bcb2516c70fe950db189de3cb431661dd60a865fa4512ff4` |
| 增量补丁 | `40,526` 字节，sha256 `3949021c4f5e7b27795a353c6b493027675d8b0be6ba409bb53691c7e322c236` |
| 文件数 | 553 |

## 渠道

- feed 已签名 `version=0.3.61`，含 patch 元数据；
- 官网指向 `v0.3.61`；
- nginx 已服务 full/app/patch/SHA256SUMS；
- GitHub Release `v0.3.61-standalone-preview.1`（含三个资产）。