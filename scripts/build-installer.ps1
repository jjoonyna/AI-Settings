[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Version, [Parameter(Mandatory=$true)][string]$OutputDir, [string]$Iscc = '')
$ErrorActionPreference = 'Stop'
if ($Version -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Invalid version: expected vX.Y.Z' }
$root = Split-Path -Parent $PSScriptRoot
if (-not $Iscc) { $Iscc = Join-Path $root 'docs/installer-exe/tools/inno/ISCC.exe' }
if (-not (Test-Path -LiteralPath $Iscc -PathType Leaf)) { throw 'ISCC compiler not found' }
$output = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force $output | Out-Null
$stage = Join-Path ([IO.Path]::GetTempPath()) ('ai-settings-payload-' + [guid]::NewGuid())
try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
  $files = @(git -c core.quotepath=false -C $root ls-files -- install.ps1 uninstall.ps1 scripts runtime nvim claude codex)
  if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
  foreach ($file in $files) {
    if ($file -match '(^|/)(tests?|\.tests|\.git|node_modules|docs)(/|$)' -or $file -match '(^|/)local\.lua$|\.bak|\.log$') { continue }
    $source = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing payload file: $file" }
    $target = Join-Path $stage $file
    New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
  }
  foreach ($required in @('install.ps1','uninstall.ps1','scripts/bootstrap.ps1','scripts/install-runtime.mjs','runtime/AI-Settings-User-Guide.ko.pdf','runtime/models.json','nvim/init.lua','claude/plugins.json','codex/work.config.toml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $required) -PathType Leaf)) { throw "Missing payload file: $required" }
  }
  & $Iscc "/DVersion=$Version" "/DPayload=$stage" "/DOutput=$output" (Join-Path $root 'installer/AI-Settings.iss')
  if ($LASTEXITCODE -ne 0) { throw "ISCC failed: $LASTEXITCODE" }
  Copy-Item -LiteralPath (Join-Path $stage 'runtime/AI-Settings-User-Guide.ko.pdf') -Destination $output -Force
} finally {
  if (Test-Path -LiteralPath $stage) {
    $resolved = (Resolve-Path -LiteralPath $stage).Path
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ((Split-Path -Parent $resolved) -ne $tempRoot -or (Split-Path -Leaf $resolved) -notmatch '^ai-settings-payload-[0-9a-f-]{36}$') { throw 'Unsafe staging cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
