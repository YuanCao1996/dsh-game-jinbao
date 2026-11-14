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
| `--size` | 192 | 画布边长（悬浮窗显示 30，可加大） |
| `--baseline` | 0.94 | 脚底对齐比例 |
| `--tolerance` | 28 | 绿幕色相容差（度） |
| `--softness` | 22 | 边缘羽化宽度（度） |
| `--no-despill` | 关 | 关掉去溢色（边缘发绿时再开） |

## 五、自测

```powershell
# 生成合成测试帧（不需要美术资产）
& $py tools\character-pipeline\tests\make-test-frames.py D:\tmp\frames

# 跑管线
& $py tools\character-pipeline\pipeline.py --input D:\tmp\frames --name idle --out tools\desktop-release\assets\pet

# 状态映射回归
powershell -File tools\desktop-release\tests\overlay-pet.test.ps1

# 悬浮窗渲染预览（不干扰正在运行的实例：用独立 StateDir）
powershell -File <安装目录>\tools\desktop-release\strategy-overlay.ps1 `
  -StateDir $env:TEMP\jinbao-pet-preview -PreviewPath D:\tmp\overlay.png -PreviewTab advice -SelfTest
```

## 六、版权提醒

- 只用**自己原创或已获授权**的角色，不要使用他人成品图（包括网上"看着合适"的图）
- 参考风格可以（风格不受版权保护），但角色特征（发型/服装/配色组合）要保持差异
- AI 生成物要确认所用工具的**商用条款**，并保留 prompt/seed 记录作为原创证据
