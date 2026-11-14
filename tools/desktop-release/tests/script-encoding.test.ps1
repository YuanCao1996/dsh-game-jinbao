# 守卫：所有 .ps1 必须带 UTF-8 BOM，否则 PowerShell 5.1 会按 ANSI(GBK) 读，
# 中文字符串会变乱码、甚至因为某个字节被当成引号而整段解析失败。
# 这次就是编辑工具保存时丢了 BOM，overlay-playback.ps1 直接解析不出来。
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scripts = Get-ChildItem -Path $root -Recurse -Filter '*.ps1' -File |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|obj|bin)\\' }

$missing = New-Object 'System.Collections.Generic.List[string]'
$broken = New-Object 'System.Collections.Generic.List[string]'
foreach ($file in $scripts) {
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  # 只有纯 ASCII 的脚本不需要 BOM；一旦有非 ASCII 字节（中文注释/字符串）就必须带 BOM，
  # 否则 PS 5.1 按 GBK 读，轻则乱码，重则某个字节被当成引号整段解析失败。
  $hasNonAscii = $false
  foreach ($byte in $bytes) { if ($byte -ge 0x80) { $hasNonAscii = $true; break } }
  if ($hasNonAscii -and -not $hasBom) { $missing.Add($file.FullName.Substring($root.Length).Replace('\', '/')) }
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$errors) | Out-Null
  if ($errors -and $errors.Count) { $broken.Add(('{0}: {1}' -f $file.Name, $errors[0].Message)) }
}

$total = $scripts.Count
if ($missing.Count) {
  Write-Output ('缺 BOM {0} 个：' -f $missing.Count)
  $missing | Select-Object -First 10 | ForEach-Object { Write-Output ('  ' + $_) }
  exit 1
}
if ($broken.Count) {
  Write-Output ('解析失败 {0} 个：' -f $broken.Count)
  $broken | Select-Object -First 10 | ForEach-Object { Write-Output ('  ' + $_) }
  exit 1
}
Write-Output ('overlay-scripts: 脚本编码 {0}/{0} 通过（全部 UTF-8 BOM、可解析）' -f $total)
