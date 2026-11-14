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

function Load-PetAction {
  param([string]$Root, [string]$Name)
  if ($script:petFrames.ContainsKey($Name)) { return $script:petFrames[$Name] }
  $dir = Join-Path (Join-Path $Root $Name) 'frames'
  if (-not (Test-Path $dir)) { $script:petFrames[$Name] = $null; return $null }
  $files = @(Get-ChildItem $dir -Filter '*.png' | Sort-Object Name)
  if (-not $files.Count) { $script:petFrames[$Name] = $null; return $null }
  $list = New-Object 'System.Collections.Generic.List[object]'
  foreach ($file in $files) {
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit()
    $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bmp.CreateOptions = [System.Windows.Media.Imaging.BitmapCreateOptions]::IgnoreImageCache
    $bmp.UriSource = New-Object System.Uri($file.FullName)
    $bmp.EndInit()
    $bmp.Freeze()
    $list.Add($bmp) | Out-Null
  }
  $script:petFrames[$Name] = $list
  return $list
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
  $script:petTimer.Start()
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
}

function Stop-PetLayer {
  if ($script:petTimer) { $script:petTimer.Stop(); $script:petTimer = $null }
}
