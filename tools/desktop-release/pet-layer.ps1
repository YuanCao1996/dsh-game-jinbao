# 金宝形象层：透明无边框窗口，播放 PNG 序列帧（每帧带 alpha）。
# 为什么用序列帧而不是 webm：WPF 没有能播 VP9-alpha 的解码器，
# Chromium/Electron 那套在这里不适用；序列帧零依赖、透明度准确、体积可控（192px 每帧约 9KB）。
param(
  [string]$FramesRoot = "D:\\work\\DSH\\.tmp\\pet-build",
  [string]$State = "idle",
  [int]$Display = 112,
  [int]$Fps = 12,
  [int]$Seconds = 6,
  [int]$Left = 200,
  [int]$Top = 200
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

function Load-PetFrames {
  param([string]$Root, [string]$Name)
  $dir = Join-Path (Join-Path $Root $Name) 'frames'
  if (-not (Test-Path $dir)) { throw "找不到帧目录：$dir" }
  $files = @(Get-ChildItem $dir -Filter '*.png' | Sort-Object Name)
  if (-not $files.Count) { throw "帧目录是空的：$dir" }
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
  return $list
}

$script:petFrames = Load-PetFrames -Root $FramesRoot -Name $State
$script:petIndex = 0
$script:petElapsed = 0
$script:petLimitMs = [Math]::Max(0, $Seconds) * 1000

$window = New-Object System.Windows.Window
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.ShowInTaskbar = $false
$window.Topmost = $true
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.Width = $Display
$window.Height = $Display
$window.Left = $Left
$window.Top = $Top

$image = New-Object System.Windows.Controls.Image
$image.Stretch = [System.Windows.Media.Stretch]::Uniform
$image.SnapsToDevicePixels = $true
$image.Source = $script:petFrames[0]
[System.Windows.Media.RenderOptions]::SetBitmapScalingMode($image, [System.Windows.Media.BitmapScalingMode]::HighQuality)
$window.Content = $image

$script:petImage = $image
$script:petWindow = $window
$script:petTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:petTimer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(30, [int](1000 / $Fps)))
$script:petStepMs = $script:petTimer.Interval.TotalMilliseconds

$script:petTimer.Add_Tick({
  if ($null -eq $script:petFrames -or $script:petFrames.Count -eq 0) { return }
  $script:petIndex = ($script:petIndex + 1) % $script:petFrames.Count
  $script:petImage.Source = $script:petFrames[$script:petIndex]
  $script:petElapsed += $script:petStepMs
  if ($script:petLimitMs -gt 0 -and $script:petElapsed -ge $script:petLimitMs) {
    $script:petTimer.Stop()
    $script:petWindow.Close()
  }
})

$window.Add_Loaded({ $script:petTimer.Start() })

Write-Output ("pet layer: state={0} frames={1} fps={2} display={3}" -f $State, $script:petFrames.Count, $Fps, $Display)
[void]$window.ShowDialog()
