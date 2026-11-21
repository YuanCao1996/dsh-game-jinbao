# 把状态目录迁移到其他盘：退出金宝后复制、改名、建 junction，再重新启动。
# 由设置页 POST /api/storage/migrate 触发，父进程退出后由本脚本接管。
param(
  [Parameter(Mandatory = $true)][string]$From,
  [Parameter(Mandatory = $true)][string]$To,
  [int]$WaitPid = 0,
  [string]$Launcher = ''
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'jinbao-storage-migrate.log'
function Write-Log([string]$text) {
  try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $text) -Encoding UTF8 } catch {}
}
function Stop-JinbaoChildren {
  param([string]$StateDir)
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*-STA*' -and $_.CommandLine -like '*strategy-overlay.ps1*'
  } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -like '*collector.mjs*' -and $_.CommandLine -like ('*' + $StateDir + '*')
  } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
}
function Fail([string]$message) {
  Write-Log ('FAIL ' + $message)
  throw $message
}

try {
  Write-Log "start from=$From to=$To pid=$WaitPid"
  if ($WaitPid -gt 0) {
    for ($i = 0; $i -lt 240; $i++) {
      if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 500
    }
    if (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Fail 'APP_STILL_RUNNING' }
  }
  Start-Sleep -Milliseconds 800
  Stop-JinbaoChildren -StateDir $From

  $item = Get-Item -LiteralPath $From -Force -ErrorAction Stop
  if ($item.LinkType) { Fail 'ALREADY_MIGRATED' }
  if (-not (Test-Path -LiteralPath $To)) {
    New-Item -ItemType Directory -Path $To -Force | Out-Null
  } elseif ((Get-ChildItem -LiteralPath $To -Force | Measure-Object).Count -gt 0) {
    Fail 'TARGET_NOT_EMPTY'
  }

  $rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(
    $From, $To, '/MIR', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NP'
  ) -Wait -PassThru -WindowStyle Hidden
  Write-Log ('robocopy exit=' + $rc.ExitCode)
  if ($rc.ExitCode -ge 8) { Fail ('COPY_FAILED_' + $rc.ExitCode) }

  $old = $From + '.migrate-old-' + (Get-Date -Format 'yyyyMMddHHmmss')
  Rename-Item -LiteralPath $From -NewName (Split-Path $old -Leaf)
  try {
    New-Item -ItemType Junction -Path $From -Target $To | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $From 'launcher-state.json'))) { Fail 'JUNCTION_VERIFY_FAILED' }
  } catch {
    if (Test-Path -LiteralPath $From) { Remove-Item -LiteralPath $From -Force -Recurse -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $old) { Rename-Item -LiteralPath $old -NewName (Split-Path $From -Leaf) }
    throw
  }
  Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
  Write-Log 'migrated ok'
  if ($Launcher -and (Test-Path -LiteralPath $Launcher)) {
    Start-Process -FilePath $Launcher -WorkingDirectory (Split-Path $Launcher -Parent)
    Write-Log 'launcher started'
  }
} catch {
  Write-Log ('error: ' + $_.Exception.Message)
  throw
}
