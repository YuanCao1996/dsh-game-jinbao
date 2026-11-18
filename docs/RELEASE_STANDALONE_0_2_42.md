# 独立桌面版 0.2.42

发布：2026-11-18 21:1x（CST）
通道：independent standalone

## 修的是什么

**「日记暂时读不出来」——不是网络问题，是凭证过期。**

设置页与日记页都靠 `X-Jinbao-Setup: <nonce>` 调用本机接口，而**应用每次重启（含安装更新）都会生成一个新的 nonce**。
设置页早就有自愈（缺 nonce 先取一次、403 再重试），但**日记页没有**：

- 直接打开 `/diary`（不带 `#nonce`）→ 用浏览器里缓存/空的旧值 → 403 → 显示「日记暂时读不出来」
- 点「重试」→ 还是那个旧值 → 依旧 403

## 修法

日记页新增 `ensureNonce()`：

- 没有合法凭证（或直接访问 `/diary`）→ 先向本机 `GET /api/setup-nonce` 取一个（该接口只对回环地址开放）；
- 任何请求收到 **403** → 丢掉旧凭证、重新取一次、**自动重试一次**；
- 取到后写回 `sessionStorage`，并同步「返回设置」链接里的 `#nonce`。

## 顺带

第一篇不再写「动笔时是 21:00」——它是补写的，钟点跟那一天对不上；星期/季节仍按那一天算。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | 41,146,378 字节，sha256 `5218e484af65f08daa173c0940c3bdfd3d0e7301b7cf6775d8793b01349ecaba` |
| 应用层 zip | 6,064,888 字节，sha256 `383962aa01d4952284453bb6f65d3d5c8fe3abb6c34a709f1a9f016dbe2d1c6d` |
| manifest sha256 | `8cd06e185587ae7ac530451cb8b3b4e95b5208a2efe3aca7da982ba4fafbbb1c` |

## 验证

```
本地 verifyPackage      应用层 478、全量 478 通过；日记页含 /api/setup-nonce
feed 验签               0.2.42 41,146,378 / app 6,064,888
HEAD 全量与应��层        长度一致
真机安装                0.2.41 → 0.2.42 自动重启，shutdown completed / failedSteps 空
线上页面                setup-nonce: true、ensureNonce: true
/api/diary              200，2 篇（11-15 日常 + 10-24 第一篇）
```
