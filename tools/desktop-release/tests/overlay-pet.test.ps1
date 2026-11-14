# 形象层状态映射回归：不启动窗口，只验证「快照 → 动作名」的判定顺序。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'overlay-pet.ps1')

$failures = New-Object 'System.Collections.Generic.List[string]'

function Check($name, $expected, $snapshot) {
  $actual = Get-PetState -Snapshot $snapshot
  if ($actual -ne $expected) { $failures.Add("$name → 期望 $expected，实际 $actual") }
}

$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

Check '无快照' 'wait' $null
Check '结算胜利' 'win' ([pscustomobject]@{ ended = $true; matchWin = $true })
Check '结算失利' 'lose' ([pscustomobject]@{ ended = $true; matchWin = $false })
Check '结算但胜负未知' 'wait' ([pscustomobject]@{ ended = $true })
Check '阵亡' 'dead' ([pscustomobject]@{ dead = $true; phase = 'InProgress' })
Check '选人' 'pick' ([pscustomobject]@{ phase = 'ChampSelect' })
Check '刚播报完' 'talk' ([pscustomobject]@{ phase = 'InProgress'; playback = @([pscustomobject]@{ at = $now - 1000; text = 'x' }); coachStatus = [pscustomobject]@{ state = 'running' } })
Check '播报已过期' 'think' ([pscustomobject]@{ phase = 'InProgress'; playback = @([pscustomobject]@{ at = $now - 30000; text = 'x' }); coachStatus = [pscustomobject]@{ state = 'running' } })
Check '动态里有进行中的步骤' 'think' ([pscustomobject]@{ phase = 'InProgress'; agentActivity = [pscustomobject]@{ rows = @([pscustomobject]@{ phase = 'running' }) } })
Check '对局中无事发生' 'idle' ([pscustomobject]@{ phase = 'InProgress'; agentActivity = [pscustomobject]@{ rows = @() } })
Check '大厅候场' 'wait' ([pscustomobject]@{ phase = 'Lobby' })

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 状态映射 11/11 通过'
