# 状态姿态：不同游戏状态要看得出区别，同时不能把呼吸/说话动画搞坏。
# 这些状态没有专属素材，靠旋转 + 透明度区分（阵亡下垂变淡、失利歪头、睡觉更垂）。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay-pet.ps1')

$failures = New-Object 'System.Collections.Generic.List[string]'
function Check($name, $condition) { if (-not $condition) { $failures.Add($name) } }

# 姿态是动画补间过去的，读 .Angle 拿到的是瞬时值；这里读基础值（动画的终值）
function Get-Angle($rotate) {
  return [double]$rotate.GetAnimationBaseValue([System.Windows.Media.RotateTransform]::AngleProperty)
}

function Get-Parts($control) {
  $group = $control.RenderTransform
  $scale = $null; $move = $null; $rotate = $null
  if ($group -is [System.Windows.Media.TransformGroup]) {
    foreach ($child in $group.Children) {
      if ($child -is [System.Windows.Media.ScaleTransform]) { $scale = $child }
      if ($child -is [System.Windows.Media.TranslateTransform]) { $move = $child }
      if ($child -is [System.Windows.Media.RotateTransform]) { $rotate = $child }
    }
  }
  return [pscustomobject]@{ Group = $group; Scale = $scale; Move = $move; Rotate = $rotate }
}

$image = New-Object System.Windows.Controls.Image

# 1) 变换组固定为三块：缩放 → 旋转 → 位移，缺的自动补齐
$parts = Get-PetTransformGroup -Control $image
Check '变换组已建立' ($parts.Group -is [System.Windows.Media.TransformGroup])
Check '三个变换都在' ($null -ne $parts.Scale -and $null -ne $parts.Rotate -and $null -ne $parts.Move)
Check '子项数量为 3' ($parts.Group.Children.Count -eq 3)
Check '顺序是 缩放/旋转/位移' (
  ($parts.Group.Children[0] -is [System.Windows.Media.ScaleTransform]) -and
  ($parts.Group.Children[1] -is [System.Windows.Media.RotateTransform]) -and
  ($parts.Group.Children[2] -is [System.Windows.Media.TranslateTransform]))

# 2) 各状态的姿态值
Set-PetPosture -Control $image -State 'idle'
Check '待机摆正' (((Get-Angle $parts.Rotate) -eq 0) -and $image.Opacity -eq 1)

Set-PetPosture -Control $image -State 'dead'
Check '阵亡下垂' ((Get-Angle $parts.Rotate) -eq -6)
Check '阵亡变淡' ([double]$image.Opacity -eq 0.75)

Set-PetPosture -Control $image -State 'lose'
Check '失利歪头' ((Get-Angle $parts.Rotate) -eq 3)
Check '失利轻微变淡' ([double]$image.Opacity -eq 0.9)

Set-PetPosture -Control $image -State 'sleep'
Check '睡觉更垂' ((Get-Angle $parts.Rotate) -eq 5 -and [double]$image.Opacity -eq 0.8)

Set-PetPosture -Control $image -State 'think'
Check '思考极轻微' ((Get-Angle $parts.Rotate) -eq -1.5)

# 3) 未知状态回落到待机，不能把形象留在歪着的姿态
Set-PetPosture -Control $image -State 'nonexistent-state'
Check '未知状态回落待机' (((Get-Angle $parts.Rotate) -eq 0) -and $image.Opacity -eq 1)

# 4) 呼吸和说话都要保留旋转这一层（以前各自 New 一个组，会把旋转吃掉）
Set-PetPosture -Control $image -State 'dead'
Start-PetBreathing -Control $image
$afterBreath = Get-Parts $image
Check '呼吸后旋转还在' ($null -ne $afterBreath.Rotate)
Check '呼吸后仍是三块' ($afterBreath.Group.Children.Count -eq 3)

Start-PetTalk -Control $image
$afterTalk = Get-Parts $image
Check '说话后旋转还在' ($null -ne $afterTalk.Rotate)
Stop-PetTalk -Control $image
$afterStop = Get-Parts $image
Check '停说话后旋转还在' ($null -ne $afterStop.Rotate)
Check '停说话后呼吸恢复' ($script:petBreathing -eq $true)

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 状态姿态 14/14 通过'
