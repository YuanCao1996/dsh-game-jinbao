# Collects a coarse, privacy-safe machine profile for the first diary entry.
# No serial numbers, MAC addresses, user names, paths or installed software.
param([string]$Out)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 默认按控制台代码页输出，中文会变成乱码；这里强制 UTF-8。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
function Safe([scriptblock]$block, $fallback) {
  try { & $block } catch { $fallback }
}
$cpu = Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 } $null
$cs = Safe { Get-CimInstance Win32_ComputerSystem } $null
$os = Safe { Get-CimInstance Win32_OperatingSystem } $null
$gpus = Safe { @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) } @()
$disks = Safe {
  @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [pscustomobject]@{ letter = $_.DeviceID; totalGb = [math]::Round($_.Size / 1GB); freeGb = [math]::Round($_.FreeSpace / 1GB) }
  })
} @()
$screen = Safe {
  $v = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -gt 0 } | Select-Object -First 1
  if ($v) { '{0}x{1}' -f $v.CurrentHorizontalResolution, $v.CurrentVerticalResolution } else { $null }
} $null
$profile = [pscustomobject]@{
  cpu         = if ($cpu) { $cpu.Name } else { $null }
  cores       = if ($cpu) { $cpu.NumberOfCores } else { $null }
  threads     = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { $null }
  memoryGb    = if ($cs) { [math]::Round($cs.TotalPhysicalMemory / 1GB) } else { $null }
  manufacturer = if ($cs) { $cs.Manufacturer } else { $null }
  model       = if ($cs) { $cs.Model } else { $null }
  os          = if ($os) { $os.Caption } else { $null }
  gpus        = $gpus
  disks       = $disks
  screen      = $screen
}
$json = $profile | ConvertTo-Json -Compress -Depth 4
if ($Out) {
  [IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
} else {
  [Console]::Out.Write($json)
}
