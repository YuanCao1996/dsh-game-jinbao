# 收起形态形象：配置解析 + 开/关/大小都按预期工作。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay-pet.ps1')

$failures = New-Object 'System.Collections.Generic.List[string]'
function Check($name, $condition) { if (-not $condition) { $failures.Add($name) } }

$stateDir = Join-Path $env:TEMP ('pet-cfg-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$petFile = Join-Path $stateDir 'pet.json'

# 1) 没有配置文件时默认开启、56（默认值调大过，44 那会儿脸看不清）
$settings = Get-PetSettings -StateDir $stateDir
Check '默认开启' ($settings.enabled -eq $true)
Check '默认大小 56' ($settings.size -eq 56)

# 2) 显式关闭
[IO.File]::WriteAllText($petFile, '{"enabled":false,"size":56}', [Text.UTF8Encoding]::new($false))
$settings = Get-PetSettings -StateDir $stateDir
Check '可以关闭' ($settings.enabled -eq $false)
Check '大小可配' ($settings.size -eq 56)

# 3) 越界的大小被夹到 28~96
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":500}', [Text.UTF8Encoding]::new($false))
Check '过大回落默认' ((Get-PetSettings -StateDir $stateDir).size -eq 56)
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":5}', [Text.UTF8Encoding]::new($false))
Check '过小回落默认' ((Get-PetSettings -StateDir $stateDir).size -eq 56)

# 4) 坏文件不抛异常
[IO.File]::WriteAllText($petFile, 'not json', [Text.UTF8Encoding]::new($false))
$settings = Get-PetSettings -StateDir $stateDir
Check '坏配置回默认' ($settings.enabled -eq $true -and $settings.size -eq 56)

# 5) 有形象素材时：初始化成功、默认隐藏（展开态不显示），配置开启后可见
$root = Join-Path $env:TEMP ('pet-assets-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $root | Out-Null
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 8, 8
$g = [System.Drawing.Graphics]::FromImage($bitmap); $g.Clear([System.Drawing.Color]::Transparent); $g.FillEllipse([System.Drawing.Brushes]::Orange, 1, 1, 6, 6); $g.Dispose()
$bitmap.Save((Join-Path $root 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose()

$script:petFrames = @{}
$image = New-Object System.Windows.Controls.Image
$tail = New-Object System.Windows.Shapes.Path
$script:petRoot = $root
# 用临时素材目录：直接调 Load 后手工初始化
$frames = Load-PetAction -Root $root -Name 'icon'
Check '图标可载入' ($null -ne $frames -and $frames.Count -eq 1)

[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":44}', [Text.UTF8Encoding]::new($false))
$script:narrowPetControl = $image
$script:narrowPetTail = $tail
$script:narrowPetStateDir = $stateDir
$script:narrowPetFrames = $frames
$image.Source = $frames[0]
$image.Visibility = 'Collapsed'
$script:narrowPetConfigAt = [DateTime]::MinValue
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'InProgress' }) -Force
Check '开启后可见' ($image.Visibility -eq 'Visible')
Check '尾巴一起显示' ($tail.Visibility -eq 'Visible')

[IO.File]::WriteAllText($petFile, '{"enabled":false,"size":44}', [Text.UTF8Encoding]::new($false))
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'InProgress' }) -Force
Check '关闭后隐藏' ($image.Visibility -eq 'Collapsed')

# 6) 调大尺寸必须触发重新排版（否则形象被条子裁掉一半，只改控件大小等于白改）
$script:metricsCalls = 0
function Set-NarrowMetrics { $script:metricsCalls++ }
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":88}', [Text.UTF8Encoding]::new($false))
$script:displayMode = 'narrow'
$script:narrowPetConfigAt = [DateTime]::MinValue
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'InProgress' }) -Force
Check '调大尺寸触发重新排版' ($script:metricsCalls -ge 1)
Check '尺寸确实生效' ($script:narrowPetSize -eq 88)

# 7) 跨局不能带着旧的挂机计时：大厅候场要把计时清零，否则新局一开就判成睡觉
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":56}', [Text.UTF8Encoding]::new($false))
$script:narrowPetConfigAt = [DateTime]::MinValue
$script:petIdleSince = (Get-Date).AddMinutes(-30)
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'Lobby' }) -Force
Check '大厅候场会重置挂机计时' ((([DateTime]::Now - $script:petIdleSince).TotalMinutes -lt 1))

# 8) 开关形象要触发重排：条子高度跟着可见性走，不然 72/88 会被裁掉一截
$script:narrowPetSize = 88          # 先假装当前就是 88，避免尺寸变化干扰这个断言
  $script:narrowPetDisplay = 88   # 内部展示尺寸同步，避免首次同步被当成配置变化
  $script:narrowPetFrame = 'head'   # 形态也要同步，否则从大厅切回局内会触发一次重排
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":88}', [Text.UTF8Encoding]::new($false))
$script:narrowPetVisible = $true
$script:narrowPetConfigAt = [DateTime]::MinValue
$script:metricsCalls = 0
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'InProgress' }) -Force
Check '配置没变不重排' ($script:metricsCalls -eq 0)

[IO.File]::WriteAllText($petFile, '{"enabled":false,"size":88}', [Text.UTF8Encoding]::new($false))
$script:narrowPetConfigAt = [DateTime]::MinValue
$script:metricsCalls = 0
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'InProgress' }) -Force
Check '关掉形象触发重排' ($script:metricsCalls -ge 1)

[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":88}', [Text.UTF8Encoding]::new($false))
$script:narrowPetConfigAt = [DateTime]::MinValue
$script:metricsCalls = 0
Update-NarrowPet -Snapshot ([pscustomobject]@{ phase = 'InProgress' }) -Force
Check '打开形象触发重排' ($script:metricsCalls -ge 1)

Remove-Item -Recurse -Force $stateDir, $root -ErrorAction SilentlyContinue

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 收起形态形象 16/16 通过'
