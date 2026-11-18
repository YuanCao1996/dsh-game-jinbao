# 独立桌面版 0.2.44

发布：2026-11-18 21:5x（CST）

## 修的是什么

设置页的「测试功能」区块（开黑队伍开关）**看不见**。

原因：设置页靠一张「`<h2>` 文字 → 页面分组」的映射表决定每个 `main>section` 属于哪一页：

```js
const groups={'显示与播报':'display', ... ,'版本与更新':'updates', ...};
node.dataset.settingsGroup = node.dataset.settingsGroup || groups[heading?.textContent];
```

我把「测试功能」插进了页面，却**没往这张表里加**，于是 `groups['测试功能']` 是 `undefined` →
`data-settings-group="undefined"`、`data-settings-active="false"` → 被 `[data-settings-active=false]{display:none!important}` 直接隐藏。

修法：映射表加 `'测试功能':'updates'`，让它归到「更新与诊断」页。

## 回归测试

新增 `tools/dsh-onboarding/tests/settings-sections.test.mjs`：
解析页面里所有 `main>section` 的标题，逐个检查是否在映射表里（靠 id 分组的节点除外），
漏一个就报出标题名。**验证过它真能咬住**：临时删掉映射 → 测试红；加回来 → 绿。

## 验证

```
本地 verifyPackage   应用层 478、全量 478 通过
构建产物渲染          <section data-settings-group="updates"> —— 分组正确
feed 验签             0.2.44 41,146,315 / app 6,064,825
真机安装              0.2.43 → 0.2.44 自动重启成功
线上渲染              分组 updates；开关状态行读到「未开启。（开启后需要重启金宝）」
```
