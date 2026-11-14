# 取一份 ffmpeg 放到 tools/character-pipeline/bin/，供 pipeline.py 读取 mp4 用。
# 为什么单独一个脚本：ffmpeg.exe 有 80MB 量级，不进 git；谁需要视频输入谁跑一次。
# 默认走 npmmirror（国内 ~17MB/s），官方 gyan.dev 只有几十 KB/s，别用 -Url 硬扛。
# 用法：
#   powershell -File tools/character-pipeline/fetch-ffmpeg.ps1
#   powershell -File tools/character-pipeline/fetch-ffmpeg.ps1 -Force        # 重新下
#   powershell -File tools/character-pipeline/fetch-ffmpeg.ps1 -Archive x.gz  # 用已下好的文件
param(
  [string]$Url = 'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.0/ffmpeg-win32-x64.gz',
  [switch]$Force,
  [string]$Archive
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here 'bin'
$exe = Join-Path $bin 'ffmpeg.exe'

if ((Test-Path $exe) -and -not $Force) {
  Write-Output "已有 ffmpeg：$exe"
  & $exe -version 2>&1 | Select-Object -First 1
  exit 0
}

New-Item -ItemType Directory -Force -Path $bin | Out-Null
$token = [guid]::NewGuid().ToString('N').Substring(0, 8)

function Expand-GzipTo($src, $dest) {
  $in = [System.IO.File]::OpenRead($src)
  try {
    $gz = New-Object System.IO.Compression.GZipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
    try {
      $out = [System.IO.File]::Create($dest)
      try { $gz.CopyTo($out) } finally { $out.Close() }
    } finally { $gz.Close() }
  } finally { $in.Close() }
}

function Expand-ZipTo($src, $dest) {
  Expand-Archive -Path $src -DestinationPath $dest -Force
  $found = Get-ChildItem -Path $dest -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
  if (-not $found) { throw '压缩包里没找到 ffmpeg.exe' }
  $found.FullName
}

if ($Archive) {
  if (-not (Test-Path $Archive)) { throw "找不到指定的文件：$Archive" }
  $src = (Resolve-Path $Archive).Path
  Write-Output "使用本地文件 $src"
} else {
  $ext = if ($Url -match '\.zip$') { 'zip' } else { 'gz' }
  $src = Join-Path $env:TEMP ("jinbao-ffmpeg-$token.$ext")
  Write-Output "下载 $Url"
  $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue)
  if ($curl) {
    & $curl.Source -L -C - --retry 5 --retry-delay 3 --connect-timeout 20 --speed-time 90 --speed-limit 10000 -o $src $Url
    if ($LASTEXITCODE -ne 0) { throw "curl 退出码 $LASTEXITCODE（重跑本脚本可续传）" }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $src
  }
}

Write-Output '展开 ffmpeg.exe ...'
if ($src -match '\.zip$') {
  $work = Join-Path $env:TEMP "jinbao-ffmpeg-$token"
  $foundExe = Expand-ZipTo $src $work
  Copy-Item $foundExe $exe -Force
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Expand-GzipTo $src $exe
}

if (-not $Archive) { Remove-Item $src -Force -ErrorAction SilentlyContinue }
if (-not (Test-Path $exe)) { throw '没生成 ffmpeg.exe' }
Write-Output "OK -> $exe  ($([math]::Round((Get-Item $exe).Length/1MB,1)) MB)"
& $exe -version 2>&1 | Select-Object -First 1
Write-Output ''
Write-Output '现在可以跑视频输入了，例如：'
Write-Output '  python tools/character-pipeline/pipeline.py --input <视频.mp4> --name idle --fps 12 --size 192'
