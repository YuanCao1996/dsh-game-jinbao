# 金宝形象层（悬浮窗内的宠物）：加载 PNG 序列帧，按对局状态切换动作。
#
# 为什么是序列帧：WPF 没有能解 VP9-alpha 的解码器，社区那套 webm + Chromium 的做法
# 搬不过来；序列帧零依赖、透明度准确，192px 每帧约 9KB，八套动作总共几 MB。
#
# 资源约定（用户重画后只要按这个目录丢文件，不用改代码）：
#   assets/pet/<状态>/frames/*.png
#   状态名：idle 待机 / talk 说话 / think 思考 / win 胜利 / lose 失利 / dead 阵亡安慰
#           pick 选人 / wait 候场 / sleep 睡觉
# 缺哪套就回落到 idle；连 idle 都没有时整层隐藏（不影响原有界面）。

$script:petFrames = @{}
$script:petState = ''
$script:petIndex = 0
$script:petTimer = $null
$script:petControl = $null
$script:petRoot = ''
$script:petIdleSince = [DateTime]::Now
$script:petEnabled = $true
# 气泡里的帧动画（和全身那套 petTimer 分开：气泡只在窄条可见时才转）
$script:narrowPetTimer = $null
$script:narrowPetIndex = 0

function Get-PetRoot {
  param([string]$BaseDir)
  if ($BaseDir -and (Test-Path $BaseDir)) { return $BaseDir }
  return (Join-Path $PSScriptRoot 'assets\pet')
}

function ConvertTo-PetBitmap {
  param([string]$Path)
  $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
  $bmp.BeginInit()
  $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $bmp.CreateOptions = [System.Windows.Media.Imaging.BitmapCreateOptions]::IgnoreImageCache
  $bmp.UriSource = New-Object System.Uri($Path)
  $bmp.EndInit()
  $bmp.Freeze()
  return $bmp
}

# 一个动作可以是：帧序列（<状态>/frames/*.png），或单张立绘（<状态>/static.png）。
# 只画了一张图也能用——单帧时用轻微呼吸动画代替序列帧，不会看起来像死图。
function Load-PetAction {
  param([string]$Root, [string]$Name)
  if ($script:petFrames.ContainsKey($Name)) { return $script:petFrames[$Name] }

  $dir = Join-Path (Join-Path $Root $Name) 'frames'
  if (Test-Path $dir) {
    $files = @(Get-ChildItem $dir -Filter '*.png' | Sort-Object Name)
    if ($files.Count) {
      $list = New-Object 'System.Collections.Generic.List[object]'
      foreach ($file in $files) { $list.Add((ConvertTo-PetBitmap -Path $file.FullName)) | Out-Null }
      $script:petFrames[$Name] = $list
      return $list
    }
  }

  # 状态级立绘：<状态>/static.png 或该状态目录下任意一张图
  $stateDir = Join-Path $Root $Name
  if (Test-Path $stateDir) {
    $static = @(Get-ChildItem $stateDir -File | Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|webp)$' } | Sort-Object Name)
    if ($static.Count) {
      $list = New-Object 'System.Collections.Generic.List[object]'
      $list.Add((ConvertTo-PetBitmap -Path $static[0].FullName)) | Out-Null
      $script:petFrames[$Name] = $list
      return $list
    }
  }

  # 全局立绘：assets/pet/static.png（只画了一张图时最省事）
  # 小尺寸优先用头部特写（30~40px 下脸比全身清楚），没有再退回全身立绘。
  foreach ($candidate in @('icon.png', 'avatar.png', 'icon.jpg', 'static.png', 'portrait.png', 'static.jpg', 'portrait.jpg')) {
    $path = Join-Path $Root $candidate
    if (Test-Path $path) {
      $list = New-Object 'System.Collections.Generic.List[object]'
      $list.Add((ConvertTo-PetBitmap -Path $path)) | Out-Null
      $script:petFrames[$Name] = $list
      return $list
    }
  }

  $script:petFrames[$Name] = $null
  return $null
}

# 气泡里只有 44px：全身帧缩进去脸就没了，看不出在说话。
# 所以窄条优先用头部特写（<状态>-narrow 目录），没有才退回全身帧。
#
# 这里必须用 Test-Path 判断"这套素材存不存在"，不能直接看 Load-PetAction 的返回：
# 它在目录缺失时会一路回落到全局 icon.png（一张静态图），于是任何没有素材的状态
# 都会被当成"有一套 1 帧的素材"，动画就退化成静态图标了。
function Get-NarrowAction {
  param([string]$Root, [string]$State)
  $inRoot = {
    param([string]$name)
    if (-not $name) { return $null }
    if (-not (Test-Path (Join-Path $Root $name))) { return $null }
    return (Load-PetAction -Root $Root -Name $name)
  }
  if ($State) {
    $head = & $inRoot ($State + '-narrow')
    if ($head) { return $head }
    if ($State -eq 'idle') {
      # 待机时通用头部素材比全身帧更适合气泡
      $generic = & $inRoot 'narrow'
      if ($generic) { return $generic }
    }
    $own = & $inRoot $State
    if ($own) { return $own }
  }
  # 这个状态没有专属素材：退回待机那一套（头部特写优先），别显示成一张全局图标
  foreach ($fallback in @('idle-narrow', 'narrow', 'idle')) {
    $frames = & $inRoot $fallback
    if ($frames) { return $frames }
  }
  # 连待机都没有：只能给全局立绘/图标
  return (Load-PetAction -Root $Root -Name 'icon')
}

# 呼吸、说话、姿态三者共用同一个 TransformGroup，顺序固定：缩放 → 旋转 → 位移。
# 以前各处各自 New 一个组，后来加旋转就会被下一次 Start-PetBreathing 建组时吃掉，
# 所以统一从这里取，缺哪个补哪个。
function Get-PetTransformGroup {
  param($Control)
  if (-not $Control) { return $null }
  $group = $Control.RenderTransform
  if (-not ($group -is [System.Windows.Media.TransformGroup])) {
    $group = New-Object System.Windows.Media.TransformGroup
    $Control.RenderTransform = $group
    $Control.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 1.0)
  }
  $scale = $null; $move = $null; $rotate = $null
  foreach ($child in $group.Children) {
    if ($child -is [System.Windows.Media.ScaleTransform] -and -not $scale) { $scale = $child }
    elseif ($child -is [System.Windows.Media.TranslateTransform] -and -not $move) { $move = $child }
    elseif ($child -is [System.Windows.Media.RotateTransform] -and -not $rotate) { $rotate = $child }
  }
  if (-not $scale) { $scale = New-Object System.Windows.Media.ScaleTransform(1.0, 1.0) }
  if (-not $rotate) { $rotate = New-Object System.Windows.Media.RotateTransform(0.0) }
  if (-not $move) { $move = New-Object System.Windows.Media.TranslateTransform(0, 0) }
  $group.Children.Clear()
  $group.Children.Add($scale) | Out-Null
  $group.Children.Add($rotate) | Out-Null
  $group.Children.Add($move) | Out-Null
  return [pscustomobject]@{ Group = $group; Scale = $scale; Rotate = $rotate; Move = $move }
}

# 单帧时的呼吸动画：轻微放大 + 上浮，避免一张静止图看起来像卡住
function Start-PetBreathing {
  param($Control)
  if (-not $Control) { return }
  try {
    $parts = Get-PetTransformGroup -Control $Control
    if (-not $parts) { return }
    $scale = $parts.Scale
    $move = $parts.Move

    $duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(2400))
    $scaleX = New-Object System.Windows.Media.Animation.DoubleAnimation(1.0, 1.03, $duration)
    $scaleY = New-Object System.Windows.Media.Animation.DoubleAnimation(1.0, 1.03, $duration)
    $lift = New-Object System.Windows.Media.Animation.DoubleAnimation(0.0, -1.5, $duration)
    foreach ($animation in @($scaleX, $scaleY, $lift)) {
      $animation.AutoReverse = $true
      $animation.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
      $animation.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
    }
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $scaleX)
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $scaleY)
    $move.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $lift)
    $script:petBreathing = $true
  } catch { }
}

function Stop-PetBreathing {
  param($Control)
  if (-not $Control) { return }
  try {
    $Control.RenderTransform = $null
    $script:petBreathing = $false
  } catch { }
}

function Initialize-PetLayer {
  param($Control, [string]$BaseDir, [int]$Fps = 12)
  if (-not $Control) { return $false }
  $script:petControl = $Control
  $script:petRoot = Get-PetRoot -BaseDir $BaseDir
  $idleFrames = Load-PetAction -Root $script:petRoot -Name 'idle'
  if (-not $idleFrames) {
    $script:petEnabled = $false
    $Control.Visibility = 'Collapsed'
    return $false
  }
  $Control.Source = $idleFrames[0]
  $Control.Visibility = 'Visible'
  $script:petState = 'idle'
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($Control, [System.Windows.Media.BitmapScalingMode]::HighQuality)
  $script:petTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:petTimer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(40, [int](1000 / $Fps)))
  $script:petTimer.Add_Tick({
    if (-not $script:petEnabled -or -not $script:petControl) { return }
    $frames = $script:petFrames[$script:petState]
    if (-not $frames -or $frames.Count -eq 0) { return }
    $script:petIndex = ($script:petIndex + 1) % $frames.Count
    $script:petControl.Source = $frames[$script:petIndex]
  })
  if ($idleFrames.Count -le 1) { Start-PetBreathing -Control $Control } else { $script:petTimer.Start() }
  return $true
}

# 口型动画只跟"真的在出声/真的在出字"走，否则没有新消息时嘴也在动。
# 三条来源：
#   1) 本机 SpeechSynthesizer 正在念（$script:synth.State）
#   2) 云端播报的实时状态 speech-status.json 是 synthesizing/playing
#   3) 字幕/滚动正在推进（$script:activePlayback，调用方自己判断）
# 状态文件每 700ms 最多读一次：这个函数会被每次快照刷新调用。
$script:petSpeechProbeAt = [DateTime]::MinValue
$script:petSpeechActive = $false

function Get-PetSpeechActive {
  try {
    if ($script:synth -and [string]$script:synth.State -eq 'Speaking') { return $true }
  } catch { }
  $now = [DateTime]::Now
  try {
    if (($now - $script:petSpeechProbeAt).TotalMilliseconds -lt 700) { return $script:petSpeechActive }
  } catch { }
  $script:petSpeechProbeAt = $now
  $active = $false
  try {
    $stateDir = $script:narrowPetStateDir
    if ($stateDir) {
      $file = Join-Path $stateDir 'speech-status.json'
      if (Test-Path $file) {
        $status = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [double]$status.at
        $state = [string]$status.state
        # 状态文件过期就当没在说，避免残留状态让嘴一直动
        if ($age -ge 0 -and $age -lt 5000 -and ($state -eq 'playing' -or $state -eq 'synthesizing')) { $active = $true }
      }
    }
  } catch { }
  $script:petSpeechActive = $active
  return $active
}

# 把快照映射成宠物状态；优先级：结算 > 阵亡 > 选人 > 说话 > 思考 > 候场 > 待机/睡觉
function Get-PetState {
  param($Snapshot)
  if (-not $Snapshot) { return 'wait' }
  $phase = [string]$Snapshot.phase
  if ($Snapshot.ended -eq $true) {
    if ($Snapshot.matchWin -eq $true) { return 'win' }
    if ($Snapshot.matchWin -eq $false) { return 'lose' }
    return 'wait'
  }
  if ($Snapshot.dead -eq $true) { return 'dead' }
  if ($phase -eq 'ChampSelect') { return 'pick' }
  # 说话：只有真的在出声（TTS）或真的在出字（字幕正在推进）才算
  $speaking = $false
  try { $speaking = Get-PetSpeechActive } catch { $speaking = $false }
  if (-not $speaking) {
    try {
      # 只认 playing：linger 是「字已经打完、在等阅读时间」，这时候嘴该停。
      # 还要求当前就在窄条形态：切到大框时播放时钟是停的，playbackPhase 会一直冻在
      # playing（实测停顿 45 秒还是 playing），不判形态的话展开再收起就会一直张嘴。
      if ($script:displayMode -eq 'narrow' -and $script:activePlayback -and [string]$script:playbackPhase -eq 'playing') { $speaking = $true }
    } catch { }
  }
  if ($speaking) { return 'talk' }
  $playback = @($Snapshot.playback)
  if ($playback.Count) {
    $last = $playback[$playback.Count - 1]
    $lastAt = [double]$(if ($null -ne $last.at) { $last.at } else { 0 })
    # 兜底窗口从 4 秒收到 1.2 秒：字打完了、话说完了就该闭嘴。
    # 4 秒会让"没有新消息"的大部分时间都判成 talk，用户看到的就是一直在张口。
    if ($lastAt -gt 0 -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $lastAt) -lt 1200) { return 'talk' }
  }
  $coach = $Snapshot.coachStatus
  if ($coach -and [string]$coach.state -eq 'running') { return 'think' }
  $rows = @($Snapshot.agentActivity.rows)
  $working = @($rows | Where-Object { $_ -and ([string]$_.phase -eq 'running' -or [string]$_.phase -eq 'draft') })
  if ($working.Count) { return 'think' }
  if ($phase -eq 'InProgress') { return 'idle' }
  return 'wait'
}

function Update-PetLayer {
  param($Snapshot)
  if (-not $script:petEnabled -or -not $script:petControl) { return }
  $desired = Get-PetState -Snapshot $Snapshot
  if ($desired -eq 'idle') {
    $rows = @($Snapshot.agentActivity.rows)
    if (([DateTime]::Now - $script:petIdleSince).TotalMinutes -ge 10 -and -not $rows.Count) { $desired = 'sleep' }
  } else {
    $script:petIdleSince = [DateTime]::Now
  }
  if ($desired -eq $script:petState) { return }
  $frames = Load-PetAction -Root $script:petRoot -Name $desired
  if (-not $frames) {
    # 没有这套动作时退回待机，别让界面空掉
    $frames = Load-PetAction -Root $script:petRoot -Name 'idle'
    $desired = 'idle'
    if (-not $frames) { return }
  }
  $script:petState = $desired
  $script:petIndex = 0
  $script:petControl.Source = $frames[0]
  if ($frames.Count -le 1) {
    if ($script:petTimer) { $script:petTimer.Stop() }
    Start-PetBreathing -Control $script:petControl
  } else {
    Stop-PetBreathing -Control $script:petControl
    if ($script:petTimer -and -not $script:petTimer.IsEnabled) { $script:petTimer.Start() }
  }
}

function Stop-PetLayer {
  if ($script:petTimer) { $script:petTimer.Stop(); $script:petTimer = $null }
}

# ── 收起形态（字幕/跑马灯）里的形象 ─────────────────────────────
# 需求：形象只在收起后出现，站在文字气泡左边当"说话的人"；
# 网页设置页可开关与调大小（配置写在 <StateDir>/pet.json）。

$script:narrowPetVisible = $false
$script:narrowPetSize = 56
$script:narrowPetConfigAt = [DateTime]::MinValue

function Get-PetSettings {
  param([string]$StateDir)
  # 默认 56：44 那会儿脸只有十几像素，眨眼/口型根本看不出来（用户反馈"人物太小看不到效果"）
  $settings = @{ enabled = $true; size = 56 }
  if (-not $StateDir) { return $settings }
  $file = Join-Path $StateDir 'pet.json'
  try {
    if (Test-Path $file) {
      $raw = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8) | ConvertFrom-Json
      if ($null -ne $raw.enabled) { $settings.enabled = ($raw.enabled -eq $true) }
      if ($null -ne $raw.size) {
        $size = [int]$raw.size
        if ($size -ge 28 -and $size -le 96) { $settings.size = $size }
      }
    }
  } catch { }
  return $settings
}

function Initialize-NarrowPet {
  param($Image, $Tail, [string]$StateDir, [string]$Root)
  $script:narrowPetStateDir = $StateDir
  if (-not $Image) { Write-PetDiag 'init-no-image'; return $false }
  $script:narrowPetControl = $Image
  $script:narrowPetTail = $Tail
  $script:narrowPetStateDir = $StateDir
  # Root 只给测试用：默认还是 assets/pet，测试要指向自己的素材目录
  $root = if ($Root) { $Root } else { Get-PetRoot -BaseDir $null }
  $script:petRoot = $root
  $frames = Get-NarrowAction -Root $root -State 'idle'
  if (-not $frames) { $frames = Load-PetAction -Root $root -Name 'icon' }
  if (-not $frames) { $frames = Load-PetAction -Root $root -Name 'idle' }
  if (-not $frames) { $Image.Visibility = 'Collapsed'; return $false }
  $script:narrowPetFrames = $frames
  $Image.Source = $frames[0]
  $Image.Visibility = 'Collapsed'
  if ($Tail) { $Tail.Visibility = 'Collapsed' }
  # 多帧就转帧动画，只有一张就叠呼吸（否则单帧会一动不动）
  if ($frames.Count -gt 1) { Start-NarrowPetAnimation } else { Start-PetBreathing -Control $Image }
  Set-PetPosture -Control $Image -State 'idle'
  return $true
}

# 推一帧。抽出来是为了能直接测（DispatcherTimer 的 Tick 没法在测试里触发）。
function Step-NarrowPetFrame {
  if (-not $script:narrowPetControl) { return $false }
  $frames = $script:narrowPetFrames
  if (-not $frames -or $frames.Count -le 1) { return $false }
  try {
    $script:narrowPetIndex = ($script:narrowPetIndex + 1) % $frames.Count
    $script:narrowPetControl.Source = $frames[$script:narrowPetIndex]
    return $true
  } catch { return $false }
}

# 气泡形象的帧动画：12fps 轮播当前状态的序列帧。
# 之前这里只设了第一帧 + 呼吸，序列帧根本不会动（动画等于没接），所以单独开一个计时器。
function Start-NarrowPetAnimation {
  param([int]$Fps = 12)
  if (-not $script:narrowPetControl) { return }
  if ($script:narrowPetTimer) { return }
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(40, [int](1000 / [Math]::Max(1, $Fps))))
  $timer.Add_Tick({
    try {
      if (-not $script:narrowPetVisible) { return }
      Step-NarrowPetFrame | Out-Null
    } catch { }
  })
  $script:narrowPetTimer = $timer
  $timer.Start()
}

function Stop-NarrowPetAnimation {
  if ($script:narrowPetTimer) {
    try { $script:narrowPetTimer.Stop() } catch { }
    $script:narrowPetTimer = $null
  }
}

# 每次快照刷新时调用：读配置（5 秒节流）→ 显示/隐藏 → 换动作
function Write-PetDiag {
  param([string]$Stage, [hashtable]$Data = @{})
  try {
    if (-not $script:narrowPetStateDir) { return }
    $line = @{ at = (Get-Date).ToString('HH:mm:ss'); stage = $Stage } + $Data | ConvertTo-Json -Compress
    [IO.File]::AppendAllText((Join-Path $script:narrowPetStateDir 'pet-diag.jsonl'), $line + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  } catch { }
}

function Update-NarrowPet {
  param($Snapshot, [switch]$Force)
  if (-not $script:narrowPetControl) { Write-PetDiag 'no-control'; return }
  $now = [DateTime]::Now
  $elapsed = 999.0
  try { $elapsed = ($now - $script:narrowPetConfigAt).TotalSeconds } catch { $elapsed = 999.0 }
  if ($Force -or $elapsed -ge 5) {
    $script:narrowPetConfigAt = $now
    $settings = Get-PetSettings -StateDir $script:narrowPetStateDir
    $enabled = [bool]$settings.enabled
    $size = [int]$settings.size
    if ($size -ne $script:narrowPetSize) {
      $script:narrowPetSize = $size
      try { $script:narrowPetControl.Width = $size; $script:narrowPetControl.Height = $size } catch { }
      # 条子高度要跟着形象走，否则调大以后会被窗口裁掉（只改了控件大小等于白改）
      try { if ($script:displayMode -eq 'narrow') { Set-NarrowMetrics } } catch { }
    }
    if ($enabled -ne $script:narrowPetVisible) {
      $script:narrowPetVisible = $enabled
      try {
        $script:narrowPetControl.Visibility = if ($enabled) { 'Visible' } else { 'Collapsed' }
        if ($script:narrowPetTail) { $script:narrowPetTail.Visibility = if ($enabled) { 'Visible' } else { 'Collapsed' } }
        Write-PetDiag 'visibility' @{ enabled = $enabled; size = $size; source = [bool]$script:narrowPetControl.Source; tail = [bool]$script:narrowPetTail }
      } catch { }
    }
  }
  if (-not $script:narrowPetVisible) { return }
  $desired = Get-PetState -Snapshot $Snapshot
  if (-not $desired) { return }
  $frames = Get-NarrowAction -Root $script:petRoot -State $desired
  if (-not $frames) { return }
  if ($script:narrowPetState -eq $desired) {
    # 状态没变也要保证动画跟随（例如从 talk 回到 idle）
    if ($desired -eq 'talk') { Start-PetTalk -Control $script:narrowPetControl } else { Stop-PetTalk -Control $script:narrowPetControl }
    return
  }
  $script:narrowPetState = $desired
  # 换状态要换整套帧并归零，否则帧动画还在轮播上一套（长度不同会越界或串帧）
  $script:narrowPetFrames = $frames
  $script:narrowPetIndex = 0
  $script:narrowPetControl.Source = $frames[0]
  if ($frames.Count -gt 1) { Start-NarrowPetAnimation } else { Stop-NarrowPetAnimation }
  Set-PetPosture -Control $script:narrowPetControl -State $desired
  if ($desired -eq 'talk') { Start-PetTalk -Control $script:narrowPetControl } else { Stop-PetTalk -Control $script:narrowPetControl }
}

# ── 状态姿态 ─────────────────────────────────────────────────
# 没有对应素材的状态（阵亡/胜利/失利/思考/候场…）以前和待机长得一模一样，
# 状态机等于白做。这里只用旋转 + 透明度做轻量区分，不需要新素材：
# 阵亡往下垂一点、变淡；失利轻微歪头；睡觉再垂一点；思考极轻微。
$script:petPosture = @{
  idle  = @{ angle = 0.0;  opacity = 1.0 }
  talk  = @{ angle = 0.0;  opacity = 1.0 }
  think = @{ angle = -1.5; opacity = 1.0 }
  win   = @{ angle = 0.0;  opacity = 1.0 }
  lose  = @{ angle = 3.0;  opacity = 0.9 }
  dead  = @{ angle = -6.0; opacity = 0.75 }
  pick  = @{ angle = -1.0; opacity = 1.0 }
  wait  = @{ angle = 0.0;  opacity = 1.0 }
  sleep = @{ angle = 5.0;  opacity = 0.8 }
}

function Set-PetPosture {
  param($Control, [string]$State)
  if (-not $Control) { return }
  $entry = $script:petPosture[$State]
  if (-not $entry) { $entry = $script:petPosture['idle'] }
  try {
    $parts = Get-PetTransformGroup -Control $Control
    if ($parts) {
      # 先把终值落到基础值上（动画结束后属性就停在这儿，读基础值也拿得到），
      # 再用 From=当前角度 补间过去，避免每次都从 0 起跳。
      $target = [double]$entry.angle
      $current = 0.0
      try { $current = [double]$parts.Rotate.Angle } catch { $current = 0.0 }
      $parts.Rotate.Angle = $target
      $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
      $animation.From = $current
      $animation.To = $target
      $animation.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(320))
      $animation.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
      $parts.Rotate.BeginAnimation([System.Windows.Media.RotateTransform]::AngleProperty, $animation)
    }
    $Control.Opacity = [double]$entry.opacity
    $script:petPostureState = $State
  } catch { }
}

# 说话时的细微动作 ─────────────────────────────────────────
# 只有一张静态立绘时，"在说话"要看得出来：用点头 + 轻微竖向挤压代替张嘴。
# 和呼吸共用一个 RenderTransformGroup（呼吸仍是基线，说话时叠加更快的一层）。
function Start-PetTalk {
  param($Control)
  if (-not $Control) { return }
  try {
    $parts = Get-PetTransformGroup -Control $Control
    if (-not $parts) { return }
    $move = $parts.Move
    $scale = $parts.Scale
    # 点头：向下 1.2px 再回位，0.5 秒一个来回
    $nod = New-Object System.Windows.Media.Animation.DoubleAnimation(0.0, 1.2, ([System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(260))))
    $nod.AutoReverse = $true
    $nod.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
    $nod.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
    # 张嘴的近似：竖向轻微压缩 2%，和点头同频
    $mouth = New-Object System.Windows.Media.Animation.DoubleAnimation(1.0, 0.98, ([System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(260))))
    $mouth.AutoReverse = $true
    $mouth.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
    $mouth.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
    $move.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $nod)
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $mouth)
    $script:petTalking = $true
  } catch { }
}

function Stop-PetTalk {
  param($Control)
  if (-not $Control) { return }
  try {
    if ($Control.RenderTransform -is [System.Windows.Media.TransformGroup]) {
      $group = [System.Windows.Media.TransformGroup]$Control.RenderTransform
      foreach ($child in $group.Children) {
        if ($child -is [System.Windows.Media.TranslateTransform]) {
          $child.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $null)
        }
        if ($child -is [System.Windows.Media.ScaleTransform]) {
          $child.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $null)
        }
      }
    }
    $script:petTalking = $false
    # 说话动作和呼吸共用 Y / ScaleY 两个属性，上面把动画清空会把呼吸一起停掉。
    # 待机现在只有一张图，呼吸是它唯一的动作，必须重新挂回去。
    Start-PetBreathing -Control $Control
  } catch { }
}
