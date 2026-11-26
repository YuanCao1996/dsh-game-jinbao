# 独立桌面版 0.3.32

发布：2026-11-26 08:3x（CST）
通道：feed + 官网 + GitHub Releases
版本：`0.3.32`（包内 `0.3.32-standalone-preview.1`）

## 本次内容

- 敌方高威胁海克斯即时播报带排名：“敌方锐雯选了珠光护手，排名第23，注意提防”；
- `enemyAugment` 针对建议带入排名/品质/效果，并要求结合英雄定位与技能；
- 名单外英雄改为删除相关句子，保留其余建议；
- 装备名校验只解析推荐动词后的候选，修复普通短语误拦；
- 队友/敌方海克斯选择消费成结构化记录，进入模型 facts；
- 本地打包 `augment-effects.json`。

## 产物

| 项 | 值 |
|---|---|
| 全量 zip | `43,015,988` 字节，sha256 `a6812dcae8eebf9af1118ba9579ff7cc3f6c4bc4ca5e5a1019711d6f7ef790d4` |
| manifest sha256 | `da4bd3d449bf7d8b0108bd267f5c28bbce74053404e6d9e50eacc199edef6cf0` |
| 应用层 zip | `7,934,498` 字节，sha256 `c11f666867c909d3bbd80c348dfddfd46db6ddf1ddf15c89d68081c4070f23be` |
| 构建 | 干净 worktree（HEAD `6a17f20`） |

## 渠道同步

- 应用内 feed：`/var/lib/jinbao-independent-downloads/latest.json`（旧 feed 已备份）；
- 官网：`/opt/jinbao-website/website/index.html` → `v0.3.32`；
- nginx：新增 `/downloads/jinbao/v0.3.32/*`，并修复历史重复 location 后 reload；
- GitHub Releases：`v0.3.32-standalone-preview.1`；
- 本机已通过签名包安装 0.3.32。