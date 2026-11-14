# 金宝形象素材链 / Character asset pipeline

形象层已经接进悬浮窗（标题旁的小形象），**你只要按下面的规格交素材，代码不用改**。

## 一、需要你交什么

按状态分目录，每个状态一组 PNG 序列帧（带 alpha）：

```
tools/desktop-release/assets/pet/
├── idle/frames/000.png …     待机（呼吸/眨眼）
├── talk/frames/…             说话（播报时）
├── think/frames/…            思考（分析中）
├── win/frames/…              胜利
├── lose/frames/…             失利
├── dead/frames/…             阵亡安慰
├── pick/frames/…             选人阶段
├── wait/frames/…             候场（大厅/加载）
└── sleep/frames/…            长时间无操作
```

**缺哪个状态就自动回落到 `idle`**；连 `idle` 都没有时整层隐藏，不会影响界面。

### 收起形态（气泡里 44px）单独一套：`<状态>-narrow`

气泡里只有 44px，全身帧缩进去脸就没了，**看不出在说话**。所以气泡优先读头部特写：

```
assets/pet/idle-narrow/frames/*.png    ← 气泡用（128px 胸像，脸占满）
assets/pet/talk-narrow/frames/*.png    ← 说话时那一套（口型幅度更大）
assets/pet/narrow/frames/*.png         ← 通用兜底（不分状态时用）
assets/pet/idle/frames/*.png           ← 大图用（全身 192px）
```

查找顺序：`<状态>-narrow` → `narrow`（仅待机）→ `<状态>` → 待机那套 → 全局立绘。
**没有 `<状态>-narrow` 就会拿全身帧塞进 44px**，所以这两个状态要成对做。

> 判断"这套素材存不存在"必须用 `Test-Path` 看目录，不能看 `Load-PetAction` 的返回——
> 它在目录缺失时会一路回落到全局 `icon.png`，于是任何没素材的状态都会变成"有一套 1 帧的素材"。

## 只画一张图也能用（单张立绘）

不想一次画九套？**一张图就能上线**，优先级从高到低自动回落：

```
<状态>/frames/*.png      ← 序列帧（有的话优先，会真动）
<状态>/static.png        ← 该状态的单张立绘
assets/pet/static.png    ← 全局立绘（只画一张时放这里，最省事）
```

单张立绘时程序不会静止不动：会叠一个 **2.4 秒的呼吸动画**（轻微放大 1.03 + 上浮 1.5px，Sine 缓动往返），
看起来是"活着"的，而不是卡住的一张图。

支持格式：`.png`（推荐，带透明）、`.jpg`、`.webp`。**推荐 1024×1024 透明 PNG**，
脚底留一点余量；不透明背景的图会显示成一块矩形，不建议。

## 二、重画规格（画的时候就要按这个来）

| 项 | 规格 |
|---|---|
| 画布 | 正方形，建议 **1024×1024**（我们缩到 192 显示，留足细节） |
| 安全区 | 角色占画布高度 **70–90%**，脚底对齐画布底部 **94%** 那条线 |
| 背景 | **透明**导出 PNG；如果是绿幕视频，用纯 `#00FF00`、不要阴影、不要渐变 |
| 动作时长 | 每个状态 **1.5–2.5 秒**循环（12 fps ≈ 18–30 帧） |
| 首尾衔接 | 循环动作的**首帧和尾帧要能接上**（否则循环处会跳） |
| 表情/口型 | `talk` 需要轻微张嘴变化；`think` 眯眼；`win` 上扬；`dead` 垂眼 |
| 体态一致 | 九个状态必须**同一个人**：固定三视图、固定服装配色、固定身高比例 |
| 体积预算 | 192px 每帧约 9KB → 每状态 20 帧约 180KB，九套合计 **< 3 MB** |

## 三、如果先用 AI 视频生成

按 [dsh-pet 的公开流程](https://github.com/PC2005-cloud/dsh-pet/blob/main/MAKE-YOUR-OWN-PET.md) 的思路（**只借流程，不用它的素材**）：

1. 先用图像模型出「三视图 + 表情设定」定稿
2. 每个状态用**首帧图生视频**，保证是同一个角色
3. 生成规格：16:9 或 1:1、纯绿幕、人物位置固定、动作全程在画幅内
4. 导出帧序列（或用我们的管线读 mp4，需要本机有 ffmpeg）

**照着 [VIDEO-PROMPTS.md](VIDEO-PROMPTS.md) 做**，里面是逐状态可直接粘贴的提示词、负面词、参数表。
三个配套脚本把这条路上最容易翻车的地方都挡掉了：

| 脚本 | 挡什么问题 |
|---|---|
| `make-greenplate.py` | 透明立绘直接喂图生视频 → 工具自己编背景，抠像必烂。先垫成纯绿首帧（默认落到 `tools/character-pipeline/firstframe/`，不进 git） |
| `check-clip.py` | 背景不纯 / 角色出画 / 时长超 3s / 首尾帧差太多 → 进管线前先体检 |
| `pick-loop.py` | 长片里挑首尾最接得上的一段（并排除水印还在的时间窗） |
| `pipeline.py` | 抠像、并集裁切、归一化、出 PNG 序列 + APNG |

一条龙（`idle` 为例）：

```powershell
$py = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
& $py tools\character-pipeline\make-greenplate.py --ratio both        # 出首帧图
# ↓ 拿首帧图去生成 2 秒绿幕动作片，存成 D:\art\idle.mp4
& $py tools\character-pipeline\check-clip.py --input D:\art\idle.mp4 --fix-hint
& $py tools\character-pipeline\pipeline.py --input D:\art\idle.mp4 --name idle --out tools\desktop-release\assets\pet --fps 12 --size 192
```


## 视频输入（mp4）怎么用

管线支持直接喂 mp4，但**需要本机有 ffmpeg**（读视频、按 fps 抽帧）。
仓库里已经备了一键脚本，装到工具自己的 `bin/` 下，不污染系统 PATH：

```powershell
# 一次性，约 29MB 下载 / 81MB 落地（走 npmmirror，国内十几 MB/s）
powershell -File tools\character-pipeline\fetch-ffmpeg.ps1

# 之后管线会自动优先用 bin\ffmpeg.exe，其次才是 PATH 里的 ffmpeg
```

> 不要用官方 gyan.dev 直链（实测只有 40–50 KB/s，114MB 要下两小时）；
> 脚本默认走的 `registry.npmmirror.com/-/binary/ffmpeg-static/` 是同一份 essentials 构建，实测 ~17 MB/s。

没有 ffmpeg 也能干活：用剪映 / PR / PotPlayer 把视频**导出成 PNG 序列**，
放进一个目录，再让管线读目录：

```powershell
& $py tools\character-pipeline\pipeline.py --input "D:\art\idle\frames" --name idle --out tools\desktop-release\assets\pet
```

## 四、跑素材链（抠像 → 归一化 → 播放资源）

```powershell
$py = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'

# 输入：帧目录（推荐）或 mp4（需要 ffmpeg）
& $py tools\character-pipeline\pipeline.py `
   --input "D:\art\idle\frames" `
   --name idle `
   --out  tools\desktop-release\assets\pet `
   --fps 12 --size 192
```

产出：

```
assets/pet/idle/frames/000.png …   ← WPF 播放用（RGBA，192px）
assets/pet/idle/anim.png           ← APNG（网页/手机端可直接播）
assets/pet/idle/action.json        ← 帧数/fps/时长/体积
```

参数说明：

| 参数 | 默认 | 作用 |
|---|---|---|
| `--size` | 192 | 画布边长（气泡那套用 128 就够，显示只有 44px） |
| `--baseline` | 0.94 | 脚底对齐比例 |
| `--key` | 0,255,0 | 键色 RGB；**AI 素材几乎都不是纯绿，按实测填**（见 ORIGIN.md） |
| `--tolerance` | 28 | 绿幕色相容差（度） |
| `--softness` | 22 | 边缘羽化宽度（度） |
| `--no-despill` | 关 | 关掉去溢色（边缘发绿时再开） |
| `--start` / `--duration` | 整段 | 只取一段（长片必用，配合 `pick-loop.py` 选窗口） |
| `--mask` | 无 | 把矩形涂成键色一起抠掉，**抹右下角水印**；可重复 |
| `--focus head` | full | 只出头部特写（气泡用；按身体中轴取胸像，不是按头发宽度） |
| `--no-union-crop` | 关 | 逐帧各自裁切。默认用并集框——头发一飘包围盒就变，逐帧裁会左右抖 |

`action.json` 里会写 `loopDelta`（首尾帧平均像素差，越小越不跳）、`crop.union`、`source.start/duration`，
方便回查这一套是怎么来的。

## 五、自测

```powershell
# 生成合成测试帧（不需要美术资产）
& $py tools\character-pipeline\tests\make-test-frames.py D:\tmp\frames

# 跑管线
& $py tools\character-pipeline\pipeline.py --input D:\tmp\frames --name idle --out tools\desktop-release\assets\pet

# 视频输入这条路（打包成 mp4 再让管线解码，验证 ffmpeg 全链）
& $py tools\character-pipeline\tests\make-test-mp4.py --out D:\tmp\test-green.mp4
& $py tools\character-pipeline\pipeline.py --input D:\tmp\test-green.mp4 --name selftest --out D:\tmp\out

# 状态映射回归
powershell -File tools\desktop-release\tests\overlay-pet.test.ps1

# 单张立绘回退
powershell -File tools\desktop-release\tests\overlay-pet-static.test.ps1

# 悬浮窗渲染预览（不干扰正在运行的实例：用独立 StateDir）
powershell -File <安装目录>\tools\desktop-release\strategy-overlay.ps1 `
  -StateDir $env:TEMP\jinbao-pet-preview -PreviewPath D:\tmp\overlay.png -PreviewTab advice -SelfTest
```

## 六、素材来源留档

每次换形象都往 [ORIGIN.md](ORIGIN.md) 追加一条：生成工具、时间、提示词、抠像参数、可商用判断。
正式收费前按那份记录复核一遍条款。

## 七、版权提醒

- 只用**自己原创或已获授权**的角色，不要使用他人成品图（包括网上"看着合适"的图）
- 参考风格可以（风格不受版权保护），但角色特征（发型/服装/配色组合）要保持差异
- AI 生成物要确认所用工具的**商用条款**，并保留 prompt/seed 记录作为原创证据
