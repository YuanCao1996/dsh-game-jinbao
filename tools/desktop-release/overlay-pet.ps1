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

# 单帧时的呼吸动画：轻微放大 + 上浮，避免一张静止图看起来像卡住
function Start-PetBreathing {
  param($Control)
  if (-not $Control) { return }
  try {
    $group = New-Object System.Windows.Media.TransformGroup
    $scale = New-Object System.Windows.Media.ScaleTransform(1.0, 1.0)
    $move = New-Object System.Windows.Media.TranslateTransform(0, 0)
    $group.Children.Add($scale) | Out-Null
    $group.Children.Add($move) | Out-Null
    $Control.RenderTransform = $group
    $Control.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 1.0)

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
  $playback = @($Snapshot.playback)
  if ($playback.Count) {
    $last = $playback[$playback.Count - 1]
    $lastAt = [double]$(if ($null -ne $last.at) { $last.at } else { 0 })
    if ($lastAt -gt 0 -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $lastAt) -lt 4000) { return 'talk' }
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
$script:narrowPetSize = 44
$script:narrowPetConfigAt = [DateTime]::MinValue

function Get-PetSettings {
  param([string]$StateDir)
  $settings = @{ enabled = $true; size = 44 }
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
  param($Image, $Tail, [string]$StateDir)
  $script:narrowPetStateDir = $StateDir
  if (-not $Image) { Write-PetDiag 'init-no-image'; return $false }
  $script:narrowPetControl = $Image
  $script:narrowPetTail = $Tail
  $script:narrowPetStateDir = $StateDir
  $root = Get-PetRoot -BaseDir $null
  $script:petRoot = $root
  $frames = Load-PetAction -Root $root -Name 'narrow'
  if (-not $frames) { $frames = Load-PetAction -Root $root -Name 'icon' }
  if (-not $frames) { $frames = Load-PetAction -Root $root -Name 'idle' }
  if (-not $frames) { $Image.Visibility = 'Collapsed'; return $false }
  $script:narrowPetFrames = $frames
  $Image.Source = $frames[0]
  $Image.Visibility = 'Collapsed'
  if ($Tail) { $Tail.Visibility = 'Collapsed' }
  Start-PetBreathing -Control $Image
  return $true
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
  if (-not $script:narrowPetFrames -or $script:narrowPetFrames.Count -le 1) { return }
  $desired = Get-PetState -Snapshot $Snapshot
  if (-not $desired) { return }
  $frames = Load-PetAction -Root $script:petRoot -Name $desired
  if (-not $frames) { return }
  if ($script:narrowPetState -eq $desired) {
    # 状态没变也要保证动画跟随（例如从 talk 回到 idle）
    if ($desired -eq 'talk') { Start-PetTalk -Control $script:narrowPetControl } else { Stop-PetTalk -Control $script:narrowPetControl }
    return
  }
  $script:narrowPetState = $desired
  $script:narrowPetControl.Source = $frames[0]
  if ($desired -eq 'talk') { Start-PetTalk -Control $script:narrowPetControl } else { Stop-PetTalk -Control $script:narrowPetControl }
}

# ── 说话时的细微动作 ─────────────────────────────────────────
# 只有一张静态立绘时，"在说话"要看得出来：用点头 + 轻微竖向挤压代替张嘴。
# 和呼吸共用一个 RenderTransformGroup（呼吸仍是基线，说话时叠加更快的一层）。
function Start-PetTalk {
  param($Control)
  if (-not $Control) { return }
  try {
    if (-not $Control.RenderTransform -or $Control.RenderTransform -isnot [System.Windows.Media.TransformGroup]) {
      $group = New-Object System.Windows.Media.TransformGroup
      $scale = New-Object System.Windows.Media.ScaleTransform(1.0, 1.0)
      $move = New-Object System.Windows.Media.TranslateTransform(0, 0)
      $group.Children.Add($scale) | Out-Null
      $group.Children.Add($move) | Out-Null
      $Control.RenderTransform = $group
      $Control.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 1.0)
    }
    $group = [System.Windows.Media.TransformGroup]$Control.RenderTransform
    $move = $null
    $scale = $null
    foreach ($child in $group.Children) {
      if ($child -is [System.Windows.Media.TranslateTransform]) { $move = $child }
      if ($child -is [System.Windows.Media.ScaleTransform]) { $scale = $child }
    }
    if (-not $move -or -not $scale) { return }
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
  } catch { }
}
