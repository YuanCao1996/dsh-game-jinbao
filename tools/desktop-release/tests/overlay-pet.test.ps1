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

# 说话只跟"真的在出声"走：之前是「最后一次播报后 4 秒」，
# 于是没有新消息的大部分时间都被判成 talk，看起来就是一直在张口。
$stateDir = Join-Path $env:TEMP ('pet-speech-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$script:narrowPetStateDir = $stateDir
$speechFile = Join-Path $stateDir 'speech-status.json'
$idleSnap = { [pscustomobject]@{ phase = 'InProgress'; agentActivity = [pscustomobject]@{ rows = @() } } }
function Reset-SpeechProbe { $script:petSpeechProbeAt = [DateTime]::MinValue }

[IO.File]::WriteAllText($speechFile, ('{{"at":{0},"state":"playing"}}' -f $now), [Text.UTF8Encoding]::new($false))
Reset-SpeechProbe
Check '实时播报中' 'talk' (& $idleSnap)

[IO.File]::WriteAllText($speechFile, ('{{"at":{0},"state":"synthesizing"}}' -f $now), [Text.UTF8Encoding]::new($false))
Reset-SpeechProbe
Check '合成中' 'talk' (& $idleSnap)

[IO.File]::WriteAllText($speechFile, ('{{"at":{0},"state":"idle"}}' -f $now), [Text.UTF8Encoding]::new($false))
Reset-SpeechProbe
Check '播报空闲不张口' 'idle' (& $idleSnap)

[IO.File]::WriteAllText($speechFile, ('{{"at":{0},"state":"playing"}}' -f ($now - 60000)), [Text.UTF8Encoding]::new($false))
Reset-SpeechProbe
Check '过期状态不算在说' 'idle' (& $idleSnap)

Remove-Item $speechFile -Force
[IO.File]::WriteAllText((Join-Path $stateDir 'speech-status.json'), 'not json', [Text.UTF8Encoding]::new($false))
Reset-SpeechProbe
Check '坏状态文件不崩' 'idle' (& $idleSnap)

# 字幕正在推进时也算在说（出字与口型要同步）
$script:narrowPetStateDir = $null
$script:activePlayback = $true
$script:playbackPhase = 'playing'
$script:displayMode = 'narrow'
Reset-SpeechProbe
Check '字幕出字中' 'talk' (& $idleSnap)

# 字已经打完、只是在等阅读时间（linger）：嘴要停，否则就是"没在说话还在动口型"
$script:playbackPhase = 'linger'
Reset-SpeechProbe
Check '等待阅读时不张口' 'idle' (& $idleSnap)

# 切到大框后播放时钟是停的，playbackPhase 会一直冻在 playing（实测停顿 45 秒仍为 playing）。
# 不判形态的话，展开再收起就会一直张嘴。
$script:playbackPhase = 'playing'
$script:displayMode = 'large'
Reset-SpeechProbe
Check '大框里暂停不算在说' 'idle' (& $idleSnap)
$script:displayMode = 'narrow'
Reset-SpeechProbe
Check '回到窄条继续算在说' 'talk' (& $idleSnap)

$script:activePlayback = $false
$script:playbackPhase = 'idle'

# 挂机睡觉：这条判定以前只写在没人调用的 Update-PetLayer 里，所以永远进不去
$script:activePlayback = $false
$script:displayMode = 'narrow'
$script:petIdleSince = [DateTime]::Now
Check '刚待机不睡' 'idle' (& $idleSnap)

$script:petIdleSince = (Get-Date).AddMinutes(-11)
Check '挂机 11 分钟睡着' 'sleep' (& $idleSnap)

# 有播报在放就不算挂机，并且要把计时器重置
$script:petIdleSince = (Get-Date).AddMinutes(-11)
$script:activePlayback = $true
$script:playbackPhase = 'linger'
Reset-SpeechProbe
Check '有话在放不睡' 'idle' (& $idleSnap)
# 这个文件的 Check 只比对状态名，计时器得直接断言
Get-PetState -Snapshot (& $idleSnap) | Out-Null
if (([DateTime]::Now - $script:petIdleSince).TotalMinutes -ge 1) { $failures.Add('有话在放会重置计时') }
$script:activePlayback = $false
$script:petIdleSince = [DateTime]::Now

Remove-Item -Recurse -Force $stateDir -ErrorAction SilentlyContinue

if ($failures.Count) {
  $failures | ForEach-Object { Write-Output ('✖ ' + $_) }
  exit 1
}
Write-Output 'overlay-pet: 状态映射 24/24 通过'
