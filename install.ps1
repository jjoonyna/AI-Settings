<# Install independent user configuration. Windows PowerShell 5.1 / Node 22+. #>
[CmdletBinding()]
param(
  [ValidateSet('both','codex')][string]$Mode,
  [string]$HomeDir = $env:USERPROFILE,
  [string]$NvimDir = (Join-Path $env:LOCALAPPDATA 'nvim'),
  [string[]]$TrustedProjects = @(),
  [string]$RbmRoot = '', [string]$DocsRoot = '',
  [string]$Jdk21 = '', [string]$Python = '',
  [switch]$SkipPlugins, [switch]$SkipTools,
  [switch]$DryRun, [switch]$NoElevate
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
if (-not $Mode) {
  if ($DryRun) { $Mode = 'both' }
  else {
    $answer = Read-Host 'AI 구성: 1 = Claude + Codex (기본), 2 = Codex만'
    if ($answer -notin @('','1','2')) { throw '1 또는 2를 선택하세요.' }
    $Mode = if ($answer -eq '2') { 'codex' } else { 'both' }
  }
}
$required = @('node','git','nvim','codex')
if ($Mode -eq 'both') { $required += 'claude' }
$missing = @($required | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) })
if ($missing.Count -and -not $DryRun) { throw ('PATH에 없음: ' + ($missing -join ', ')) }
. (Join-Path $PSScriptRoot 'scripts/lib.ps1')
$options = @{
  mode = $Mode; home = [IO.Path]::GetFullPath($HomeDir); nvim = [IO.Path]::GetFullPath($NvimDir)
  trusted = @($TrustedProjects | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
  jdk = (Find-Jdk21 -Jdk21Arg $Jdk21); python = (Find-Python -PythonArg $Python)
  rbm = $RbmRoot; docs = $DocsRoot; dryRun = [bool]$DryRun; skipTools = [bool]$SkipTools
}
$requestPath = Join-Path $env:TEMP ('ai-settings-install-' + [guid]::NewGuid() + '.json')
try {
  [IO.File]::WriteAllText($requestPath, ($options | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
  & node (Join-Path $PSScriptRoot 'scripts/install-runtime.mjs') $requestPath
  if ($LASTEXITCODE -ne 0) { throw '설치 실패. 변경 파일은 자동 복구되며 상세 오류를 확인하세요.' }
  if ($Mode -eq 'both' -and -not $SkipPlugins) { Install-Plugins -PluginsJson (Join-Path $PSScriptRoot 'claude/plugins.json') -DryRun:$DryRun }
  if ($SkipTools) { Write-Warning '디자인/PPT 도구 설치를 건너뛰었습니다. 일반 설치로 다시 실행하면 설치됩니다.' }
  if ($DryRun) { Write-Host '설치 예정 내용만 출력했습니다. 설정은 변경하지 않았습니다.' }
  else { Write-Host '완료. Neovim을 다시 열고 필요한 CLI에 로그인하세요. 원본 clone 위치는 실행에 사용하지 않습니다.' }
} finally { Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue }
