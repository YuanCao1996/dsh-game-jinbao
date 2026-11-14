# 收起形态形象：配置解析 + 开/关/大小都按预期工作。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay-pet.ps1')

$failures = New-Object 'System.Collections.Generic.List[string]'
function Check($name, $condition) { if (-not $condition) { $failures.Add($name) } }

$stateDir = Join-Path $env:TEMP ('pet-cfg-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$petFile = Join-Path $stateDir 'pet.json'

# 1) 没有配置文件时默认开启、44
$settings = Get-PetSettings -StateDir $stateDir
Check '默认开启' ($settings.enabled -eq $true)
Check '默认大小 44' ($settings.size -eq 44)

# 2) 显式关闭
[IO.File]::WriteAllText($petFile, '{"enabled":false,"size":56}', [Text.UTF8Encoding]::new($false))
$settings = Get-PetSettings -StateDir $stateDir
Check '可以关闭' ($settings.enabled -eq $false)
Check '大小可配' ($settings.size -eq 56)

# 3) 越界的大小被夹到 28~96
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":500}', [Text.UTF8Encoding]::new($false))
Check '过大回落默认' ((Get-PetSettings -StateDir $stateDir).size -eq 44)
[IO.File]::WriteAllText($petFile, '{"enabled":true,"size":5}', [Text.UTF8Encoding]::new($false))
Check '过小回落默认' ((Get-PetSettings -StateDir $stateDir).size -eq 44)

# 4) 坏文件不抛异常
[IO.File]::WriteAllText($petFile, 'not json', [Text.UTF8Encoding]::new($false))
$settings = Get-PetSettings -StateDir $stateDir
Check '坏配置回默认' ($settings.enabled -eq $true -and $settings.size -eq 44)

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

Remove-Item -Recurse -Force $stateDir, $root -ErrorAction SilentlyContinue

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 收起形态形象 10/10 通过'
