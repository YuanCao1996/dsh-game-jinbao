# 单张立绘回退：只画一张图也能显示，且不报错。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay-pet.ps1')

$failures = New-Object 'System.Collections.Generic.List[string]'
function Check($name, $condition) { if (-not $condition) { $failures.Add($name) } }

$root = Join-Path $env:TEMP ('pet-static-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null

# 造一张 8×8 的透明 PNG 当作立绘
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 8, 8
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.FillEllipse([System.Drawing.Brushes]::Orange, 1, 1, 6, 6)
$graphics.Dispose()
$portrait = Join-Path $root 'static.png'
$bitmap.Save($portrait, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

# 1) 只有全局立绘时，任何状态都能拿到 1 帧
$frames = Load-PetAction -Root $root -Name 'idle'
Check '全局立绘应能载入' ($null -ne $frames -and $frames.Count -eq 1)
$other = Load-PetAction -Root $root -Name 'win'
Check '其它状态回落到全局立绘' ($null -ne $other -and $other.Count -eq 1)

# 2) 状态目录里的单张立绘优先于全局
$winDir = Join-Path $root 'win'
New-Item -ItemType Directory -Force -Path $winDir | Out-Null
Copy-Item $portrait (Join-Path $winDir 'static.png')
$script:petFrames = @{}
$win = Load-PetAction -Root $root -Name 'win'
Check '状态级立绘可载入' ($null -ne $win -and $win.Count -eq 1)

# 3) 什么都没有时返回 null（调用方会隐藏整层）
$empty = Join-Path $env:TEMP ('pet-empty-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $empty | Out-Null
$script:petFrames = @{}
Check '无素材返回 null' ($null -eq (Load-PetAction -Root $empty -Name 'idle'))

# 4) 初始化：单帧不启动计时器（避免空转），控件可见
$control = New-Object System.Windows.Controls.Image
$control.Visibility = 'Collapsed'
$script:petFrames = @{}
$ready = Initialize-PetLayer -Control $control -BaseDir $root -Fps 12
Check '单帧也应初始化成功' ($ready -eq $true)
Check '控件应可见' ($control.Visibility -eq 'Visible')
Check '单帧不跑序列计时器' ($null -eq $script:petTimer -or -not $script:petTimer.IsEnabled)
Stop-PetLayer
Remove-Item -Recurse -Force $root, $empty -ErrorAction SilentlyContinue

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 单张立绘回退 6/6 通过'
