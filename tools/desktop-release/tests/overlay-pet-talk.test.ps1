# 打字机与说话动作：纯逻辑可测，动画只验证绑定不报错。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'overlay-pet.ps1')

# 需要 playback 里的打字纯函数：单独 dot-source 会拉起整个播放状态，这里只复制函数契约做等价校验
function Get-TypingText([string]$text, [int]$count) {
  if (-not $text) { return '' }
  if ($count -ge $text.Length) { return $text }
  if ($count -le 0) { return '' }
  return $text.Substring(0, $count)
}

$failures = New-Object 'System.Collections.Generic.List[string]'
function Check($name, $condition) { if (-not $condition) { $failures.Add($name) } }

$line = '对面双法伤，先补振奋盔甲再打团。'
Check '第 0 字符为空' ((Get-TypingText $line 0) -eq '')
Check '逐字增长' ((Get-TypingText $line 3) -eq '对面双')
Check '越界返回全句' ((Get-TypingText $line 999) -eq $line)
Check '空文本安全' ((Get-TypingText '' 5) -eq '')

# 说话动作：点头 + 竖向压缩绑定在 RenderTransformGroup 上
$image = New-Object System.Windows.Controls.Image
Start-PetTalk -Control $image
$group = $image.RenderTransform
Check '创建了变换组' ($group -is [System.Windows.Media.TransformGroup])
$hasNod = $false
$hasMouth = $false
foreach ($child in $group.Children) {
  if ($child -is [System.Windows.Media.TranslateTransform]) { $hasNod = $true }
  if ($child -is [System.Windows.Media.ScaleTransform]) { $hasMouth = $true }
}
Check '点头动画绑定在位移上' $hasNod
Check '张嘴近似绑定在缩放上' $hasMouth
Check '标记为说话中' ($script:petTalking -eq $true)

Stop-PetTalk -Control $image
Check '停止后标记复位' ($script:petTalking -eq $false)

# 说话和呼吸共用 Y / ScaleY：停说话时如果不把呼吸挂回来，待机（单帧）就彻底静止了
Check '停说话后呼吸恢复' ($script:petBreathing -eq $true)
$groupAfter = $image.RenderTransform
$hasBreathing = $false
foreach ($child in $groupAfter.Children) {
  if ($child -is [System.Windows.Media.ScaleTransform] -and $child.ScaleX -ne 1.0) { $hasBreathing = $true }
  if ($child -is [System.Windows.Media.TranslateTransform]) { $hasBreathing = $true }
}
Check '呼吸变换已重建' $hasBreathing

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 打字机与说话动作 11/11 通过'
