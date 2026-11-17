param(
  [Parameter(Mandatory = $true)][string]$BuildDir,
  [string[]]$Shortcuts = @(
    (Join-Path $env:USERPROFILE 'Desktop\金宝.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\金宝\金宝.lnk')
  )
)
# Point the desktop / start-menu shortcuts at the freshly built preview so that
# double-clicking never launches an old folder again.
$ErrorActionPreference = 'Stop'
$exe = Join-Path $BuildDir 'jinbao.exe'
if (-not (Test-Path $exe)) { throw "missing executable: $exe" }
$icon = Join-Path $BuildDir 'jinbao.ico'
if (-not (Test-Path $icon)) {
  $png = Join-Path $BuildDir 'tools\desktop-release\assets\pet\icon.png'
  if (Test-Path $png) {
    try {
      Add-Type -AssemblyName System.Drawing
      $img = [Drawing.Image]::FromFile($png)
      try {
        $frames = New-Object System.Collections.ArrayList
        foreach ($size in @(256, 128, 64, 48, 32, 16)) {
          $bmp = [Drawing.Bitmap]::new($size, $size)
          $g = [Drawing.Graphics]::FromImage($bmp)
          $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.DrawImage($img, 0, 0, $size, $size)
          $g.Dispose()
          $ms = [IO.MemoryStream]::new()
          $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
          $bmp.Dispose()
          [void]$frames.Add([pscustomobject]@{ Size = $size; Bytes = $ms.ToArray() })
          $ms.Dispose()
        }
        $out = [IO.MemoryStream]::new()
        $bw = [IO.BinaryWriter]::new($out)
        $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
          $dim = $frame.Size
          if ($dim -ge 256) { $dim = 0 }
          $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
          $bw.Write([UInt16]1); $bw.Write([UInt16]32)
          $bw.Write([UInt32]$frame.Bytes.Length); $bw.Write([UInt32]$offset)
          $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $bw.Write($frame.Bytes) }
        $bw.Flush()
        [IO.File]::WriteAllBytes($icon, $out.ToArray())
        $bw.Dispose(); $out.Dispose()
      } finally { $img.Dispose() }
    } catch { Write-Output ('icon: skipped (' + $_.Exception.Message + ')') }
  }
}
$version = ''
$pkg = Join-Path $BuildDir 'package.json'
if (Test-Path $pkg) { try { $version = (Get-Content $pkg -Raw | ConvertFrom-Json).version } catch {} }
$shell = New-Object -ComObject WScript.Shell
foreach ($path in $Shortcuts) {
  $parent = Split-Path $path -Parent
  if (-not (Test-Path $parent)) { continue }
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = $exe
  $link.Arguments = ''
  $link.WorkingDirectory = $BuildDir
  $link.Description = ('金宝 · 独立预览版 ' + $version)
  if (Test-Path $icon) { $link.IconLocation = $icon + ',0' }
  $link.Save()
  Write-Output ('shortcut: ' + $path)
}
