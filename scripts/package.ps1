param([string]$ElectronDirectory = '', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ElectronDirectory) { $ElectronDirectory = Join-Path $projectRoot 'node_modules\electron\dist' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$runtimePath = (Resolve-Path -LiteralPath $ElectronDirectory).Path
$metadata = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$bundleName = 'Chixiao-Windows-x64-' + $metadata.version
$targetPath = [IO.Path]::GetFullPath((Join-Path $OutputDirectory $bundleName))
if (Test-Path -LiteralPath $targetPath) { throw 'Output already exists. Choose a new output directory; no existing files will be overwritten.' }
$manifestJson = & node (Join-Path $PSScriptRoot 'audit.js') --json
if ($LASTEXITCODE -ne 0) { throw 'Release audit failed' }
$manifest = $manifestJson | ConvertFrom-Json
New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
# Copy only the installed Electron runtime, never an existing application bundle.
Get-ChildItem -LiteralPath $runtimePath | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Recurse -Force }
Rename-Item -LiteralPath (Join-Path $targetPath 'electron.exe') -NewName 'Chixiao.exe'
$appDir = Join-Path $targetPath 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
foreach ($entry in $manifest) {
  $destination = Join-Path $appDir $entry.file
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot $entry.file) -Destination $destination
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('Hash mismatch: ' + $entry.file) }
}
$manifestJson | Set-Content -LiteralPath (Join-Path $targetPath 'PUBLIC-FILES.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $targetPath 'README-Chixiao.md')
$zipPath = $targetPath + '.zip'
# Some official runtime files use pre-1980 timestamps, which ZIP cannot encode.
# Normalize copied files only, also avoiding machine-specific build timestamps.
$archiveEpoch = [DateTime]::SpecifyKind([DateTime]'2026-01-01', [DateTimeKind]::Utc)
Get-ChildItem -LiteralPath $targetPath -Recurse -Force | ForEach-Object { $_.LastWriteTimeUtc = $archiveEpoch }
Compress-Archive -LiteralPath $targetPath -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
($hash + '  ' + [IO.Path]::GetFileName($zipPath)) | Set-Content -LiteralPath ($zipPath + '.sha256') -Encoding ascii
Write-Output ('Packaged: ' + $zipPath)
Write-Output ('SHA256: ' + $hash)
