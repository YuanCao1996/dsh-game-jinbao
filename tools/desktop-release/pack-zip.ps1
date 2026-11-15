param(
 [Parameter(Mandatory=$true)][string]$Source,
 [Parameter(Mandatory=$true)][string]$Archive,
 [string[]]$Skip=@()
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$Source=[IO.Path]::GetFullPath($Source).TrimEnd('\')
if(Test-Path -LiteralPath $Archive){Remove-Item -LiteralPath $Archive -Force}
# Windows PowerShell 5.1's ZipFile.CreateFromDirectory writes entry names with backslashes,
# which the installer rejects as an unsafe path, so every entry is written here with '/'.
# ASCII-only source on purpose: a BOM-less script is read as ANSI and a non-ASCII comment
# can swallow the following line.
$skipSet=@{}
foreach($name in $Skip){$skipSet[$name.Replace('\','/').ToLowerInvariant()]=$true}
$stamp=[DateTimeOffset]::new(2020,1,1,0,0,0,[TimeSpan]::Zero)
$count=0
$zip=[IO.Compression.ZipFile]::Open($Archive,[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($file in Get-ChildItem -LiteralPath $Source -Recurse -File){
  $rel=$file.FullName.Substring($Source.Length+1).Replace('\','/')
  if($skipSet.ContainsKey($rel.ToLowerInvariant())){continue}
  $entry=$zip.CreateEntry($rel,[IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime=$stamp
  $target=$entry.Open()
  try{
   $reader=[IO.File]::OpenRead($file.FullName)
   try{$reader.CopyTo($target)}finally{$reader.Dispose()}
  } finally {$target.Dispose()}
  $count++
 }
} finally {
 $zip.Dispose()
}
Write-Host ("packed {0} files into {1}" -f $count,(Split-Path -Path $Archive -Leaf))
