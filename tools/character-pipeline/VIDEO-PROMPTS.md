# 动作视频生成提示词（图生视频）

> 目标：每个状态一段 2 秒循环动作，纯绿幕、机位不动、角色不跑出画幅。
> 按顺序做完 `idle` → `talk`，其余状态等这两个跑通了再批量补。

## 第 0 步：先做首帧图（必做）

透明 PNG 直接喂给图生视频工具，出来的一定是它们自己编的背景（渐变/房间/光斑），抠像会烂。
先把角色垫到纯绿上：

```powershell
$py = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
& $py tools\character-pipeline\make-greenplate.py --ratio both
```

产出 `tools\character-pipeline\firstframe\greenplate-1x1.png`（1024²）和 `greenplate-16x9.png`（1920×1080），
角色高占 82%、脚底对齐 94%，和后续抠像用的是同一套构图。（`firstframe/` 是生成中间产物，不进 git。）

## 第 1 步：通用设定（每段提示词都要带）

这一段决定「还是不是同一个人」，别省：

```
同一角色，蓝黑色长直发、白色头戴式耳机带麦克风、黑底米白袖棒球夹克（袖口有三条纹）、
白色高领内搭、黑色百褶裙配白色裙边、白色中筒袜、黑色玛丽珍鞋。
二次元赛璐璐动画风格，正面全身，固定机位不动，纯亮绿色背景（#00FF00），
背景干净无阴影无渐变，全身始终完整留在画面内。
```

## 第 2 步：逐状态动作词

| 状态 | 排期 | 动作描述（接在通用设定后面） |
|---|---|---|
| `idle` | **先做** | 轻微呼吸起伏，头发和耳机线自然轻摆，2 秒内缓慢眨眼一次，表情平静自然 |
| `talk` | **先做** | 嘴部轻微开合说话（幅度小、不要夸张），头部极轻点头，其余保持静止 |
| `think` | 之后 | 眼睛微微眯起、视线略向上，右手抬起轻碰下巴，缓慢思考状 |
| `win` | 之后 | 嘴角上扬露出笑容，身体轻轻上抬一次，头发随之上扬 |
| `lose` | 之后 | 视线下垂、眉毛微皱，肩膀轻微下沉，低头一点点 |
| `dead` | 之后 | 闭眼，头微微低垂，肩膀放松，安静不动 |
| `pick` | 之后 | 头部左右轻微转动像在挑选，表情专注 |
| `wait` | 之后 | 几乎静止的待机，只有极轻微呼吸和偶发眨眼 |
| `sleep` | 之后 | 闭眼，头部缓慢下垂，呼吸幅度变大，睡着状态 |

## 第 3 步：负面提示词

```
不要改变角色长相和服装，不要换发型；不要镜头运动、推拉、旋转；
不要角色移动位置或走出画面；不要加文字、水印、UI、边框；
不要叶片/粒子/光斑/星光/速度线特效；不要绿幕以外的背景元素；
不要真实照片风格或 3D 渲染风格。
```

## 第 4 步：工具设置

| 项 | 值 | 说明 |
|---|---|---|
| 首帧 | `greenplate-1x1.png`（或 16:9） | 必须用第 0 步产出的图 |
| 时长 | 2 秒 | 循环动作，越长越容易跑偏 |
| 比例 | 1:1 或 16:9 | 和首帧一致，别混 |
| 运镜 | 固定/静态机位 | 有运镜就没法循环 |
| 运动幅度 | 小 | 幅度大→首尾接不上→循环处跳帧 |
| 分辨率 | 720p 以上即可 | 最终只显示 192px，别为 4K 多花钱 |

> 同一段不满意就**重新生成整段**，不要拿两段拼——拼接点必然接不上。

## 第 5 步：出片先体检，再进管线

生成完先跑体检，能提前发现「背景不是纯绿」「角色跑出画面」「时长不对」：

```powershell
& $py tools\character-pipeline\check-clip.py --input D:\art\idle.mp4
```

体检过了再抠像：

```powershell
& $py tools\character-pipeline\pipeline.py `
   --input "D:\art\idle.mp4" --name idle `
   --out tools\desktop-release\assets\pet --fps 12 --size 192
```

## 第 6 步：装进悬浮窗看效果

```powershell
# 用独立 StateDir 预览，不影响正在跑的对局实例
powershell -File <安装目录>\tools\desktop-release\strategy-overlay.ps1 `
  -StateDir $env:TEMP\jinbao-pet-preview -PreviewPath D:\tmp\overlay.png -PreviewTab advice -SelfTest
```

满意后再让程序真正读取（程序按 `idle/frames → idle/static.png → static.png` 顺序回落，
只要 `frames/` 里有图就会自动播动画，不用改代码）。

## 做完记得留档

在 [ORIGIN.md](ORIGIN.md) 的「待补」表里填上：用的工具、原样保存的提示词、生成时间、抠像参数。
这是 AI 生成物的原创证据，收费前要复核条款。
