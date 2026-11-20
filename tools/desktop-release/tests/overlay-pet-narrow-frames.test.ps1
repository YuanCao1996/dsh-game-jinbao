# 气泡形象的帧动画：真的会动、换状态会换帧、头部特写优先。
# 之前这层只设了第一帧 + 呼吸，序列帧等于没接上——这套测试就是盯住这个回归。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay-pet.ps1')

$failures = New-Object 'System.Collections.Generic.List[string]'
function Check($name, $condition) { if (-not $condition) { $failures.Add($name) } }

function New-TestFrames([string]$dir, [string]$state, [int]$count, [System.Drawing.Color]$color) {
  $target = Join-Path (Join-Path $dir $state) 'frames'
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  for ($i = 0; $i -lt $count; $i++) {
    $bmp = New-Object System.Drawing.Bitmap 8, 8
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $color), 1, 1, 6, 6)
    $g.Dispose()
    $bmp.Save((Join-Path $target ('{0:000}.png' -f $i)), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
}

$root = Join-Path $env:TEMP ('pet-frames-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null

# idle 全身 3 帧，idle-narrow 头部特写 4 帧，narrow 通用 2 帧，talk 2 帧
New-TestFrames $root 'idle' 3 ([System.Drawing.Color]::Orange)
New-TestFrames $root 'idle-narrow' 4 ([System.Drawing.Color]::DeepSkyBlue)
New-TestFrames $root 'narrow' 2 ([System.Drawing.Color]::SeaGreen)
New-TestFrames $root 'talk' 2 ([System.Drawing.Color]::Crimson)

$script:petFrames = @{}
$loadedIdle = Load-PetAction -Root $root -Name 'idle'
$loadedIdleNarrow = Load-PetAction -Root $root -Name 'idle-narrow'
$loadedNarrow = Load-PetAction -Root $root -Name 'narrow'

# 1) 头部特写优先：气泡里要脸，不是全身
$pick = Get-NarrowAction -Root $root -State 'idle'
Check '气泡优先用头部特写' ($pick.Count -eq 4)
Check '头部特写是另一套素材' (-not [object]::ReferenceEquals($pick, $loadedIdle))

# 2) 没有 <状态>-narrow 时用该状态自己的全身帧
$pickTalk = Get-NarrowAction -Root $root -State 'talk'
Check 'talk 没有头部特写就用全身帧' ($pickTalk.Count -eq 2)

# 2b) 完全没有素材的状态要退回待机那套头部特写，不能退化成一张全局图标
#     （Load-PetAction 在目录缺失时会回落 icon.png，直接看返回值会被骗）
$pickThink = Get-NarrowAction -Root $root -State 'think'
Check '无素材状态退回待机头部特写' ($pickThink.Count -eq 4)

# 2c) 形态开关：局外全身（跳过 -narrow），局内头肩
$fullPick = Get-NarrowAction -Root $root -State 'idle' -Frame 'full'
Check '全身模式跳过头部特写' ($fullPick.Count -eq 3)
Check '全身模式用 idle 全身帧' (-not [object]::ReferenceEquals($fullPick, $loadedIdleNarrow))
Check '对局判定: 大厅不算局内' ((Test-NarrowPetInMatch ([pscustomobject]@{ phase = 'Lobby' })) -eq $false)
Check '对局判定: 选人不算局内' ((Test-NarrowPetInMatch ([pscustomobject]@{ phase = 'ChampSelect' })) -eq $false)
Check '对局判定: InProgress 是局内' ((Test-NarrowPetInMatch ([pscustomobject]@{ phase = 'InProgress' })) -eq $true)
Check '对局判定: 已结束不算局内' ((Test-NarrowPetInMatch ([pscustomobject]@{ phase = 'InProgress'; ended = $true; gameSeconds = 10 })) -eq $false)
Check '对局判定: 只有对局时钟也算局内' ((Test-NarrowPetInMatch ([pscustomobject]@{ phase = ''; gameSeconds = 42 })) -eq $true)

# 3) 头部特写和通用 narrow 都没有时，退回状态自己
Remove-Item -Recurse -Force (Join-Path $root 'narrow'), (Join-Path $root 'idle-narrow')
$script:petFrames = @{}
$pickIdle2 = Get-NarrowAction -Root $root -State 'idle'
Check '都没有时退回 idle 全身' ($pickIdle2.Count -eq 3)

# 4) 帧推进：0→1→2→3→0
$image = New-Object System.Windows.Controls.Image
$script:narrowPetControl = $image
$script:narrowPetFrames = $loadedIdleNarrow
$script:narrowPetIndex = 0
$order = New-Object 'System.Collections.Generic.List[int]'
for ($i = 0; $i -lt 5; $i++) {
  $advanced = Step-NarrowPetFrame
  $order.Add($script:narrowPetIndex)
  if (-not $advanced) { Check '帧推进返回 true' $false }
}
Check '帧按顺序循环' (($order -join ',') -eq '1,2,3,0,1')

# 5) 源真的换了（不是只改下标）
$firstSource = $script:narrowPetControl.Source
Step-NarrowPetFrame | Out-Null
Check '切换后 Source 变了' (-not [object]::ReferenceEquals($firstSource, $script:narrowPetControl.Source))

# 6) 单帧不该假装在推进
$script:narrowPetFrames = @($loadedIdleNarrow[0])
Check '单帧不推进' ((Step-NarrowPetFrame) -eq $false)

# 7) 初始化时多帧会开动画计时器、单帧不会
$script:petFrames = @{}
$script:narrowPetTimer = $null
$script:narrowPetControl = $null
$image2 = New-Object System.Windows.Controls.Image
$tail2 = New-Object System.Windows.Shapes.Path
$ok = Initialize-NarrowPet -Image $image2 -Tail $tail2 -StateDir $root -Root $root
Check '初始化返回成功' ($ok -eq $true)
Check '多帧启动动画计时器' ($null -ne $script:narrowPetTimer)
Stop-NarrowPetAnimation
Check '停止后计时器清空' ($null -eq $script:narrowPetTimer)

# 8) 换状态：帧集会换、下标归零（否则长度不同会串帧）
$script:petFrames = @{}
$script:petRoot = $root
$script:narrowPetControl = $image2
$script:narrowPetFrames = $loadedIdleNarrow
$script:narrowPetIndex = 3
$script:narrowPetState = 'idle'
$script:narrowPetVisible = $true
$script:narrowPetStateDir = $root
$script:narrowPetConfigAt = [DateTime]::Now
[IO.File]::WriteAllText((Join-Path $root 'pet.json'), '{"enabled":true,"size":44}', [Text.UTF8Encoding]::new($false))
# 让状态映射给出 talk：播报时间戳在 4 秒内
$nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$talkSnapshot = [pscustomobject]@{ phase = 'InProgress'; playback = @([pscustomobject]@{ at = $nowMs; text = '测试' }) }
Check '快照映射为 talk' ((Get-PetState -Snapshot $talkSnapshot) -eq 'talk')
Update-NarrowPet -Snapshot $talkSnapshot -Force
Check '换状态后下标归零' ($script:narrowPetIndex -eq 0)
Check '换状态后帧集换成 talk' ($script:narrowPetFrames.Count -eq 2)
Stop-NarrowPetAnimation

Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue

$total = 21
if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output ("overlay-pet: 气泡帧动画 {0}/{1} 通过" -f $total, $total)
