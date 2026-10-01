<#
.SYNOPSIS  AI-Settings 저장소를 이 PC 의 ~/.claude, ~/.codex, nvim 설정에 연결한다.
.EXAMPLE   .\install.ps1 -TrustedProjects @('C:\ExRBM\rbm') -RbmRoot 'C:\ExRBM\rbm'
.EXAMPLE   .\install.ps1 -Jdk21 'C:\Program Files\Java\jdk-21' -Python 'C:\Python311\python.exe'
#>
[CmdletBinding()]
param(
  [string]$HomeDir = $env:USERPROFILE,
  [string]$NvimDir = (Join-Path $env:LOCALAPPDATA 'nvim'),
  [string[]]$TrustedProjects = @(),
  [string]$RbmRoot = '',
  [string]$DocsRoot = '',
  [string]$Jdk21 = '',
  [string]$Python = '',
  [switch]$SkipPlugins,
  [switch]$DryRun,
  [switch]$NoElevate
)
$TrustedProjects = @($TrustedProjects | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
. "$Repo\scripts\lib.ps1"

$claudeHome = Join-Path $HomeDir '.claude'
$codexHome  = Join-Path $HomeDir '.codex'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $HomeDir ".agent-env-backup\$stamp"
$report = New-Object System.Collections.ArrayList

function Say($msg) { Write-Host $msg }

# 0. 요구사항
Say '== 요구사항 확인'
$missing = @('git','node','nvim','claude','codex') | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
if ($missing) { Say ("  PATH 에 없음: " + ($missing -join ', ')); if (-not $DryRun) { throw '필수 도구가 없어 중단합니다.' } }
else { Say '  git / node / nvim / claude / codex 모두 있음' }
if ($DryRun) { Say '  (-DryRun: 아무것도 바꾸지 않습니다)' }

# 0b. symlink 가능 여부. 불가하면 관리자 권한으로 자기 자신을 다시 실행한다(UAC). 취소되면 복사 폴백.
$canSymlink = Test-SymlinkCapable
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $canSymlink -and -not $isAdmin -and -not $NoElevate -and -not $DryRun) {
  Say '  symlink 권한이 없습니다(개발자 모드 꺼짐). 관리자 권한으로 다시 실행합니다 — UAC 창을 승인하세요. 취소하면 파일은 복사로 폴백합니다.'
  $q = { param($s) '"' + $s + '"' }
  $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(& $q $PSCommandPath),'-NoElevate',
               '-HomeDir',(& $q ($HomeDir.TrimEnd('\'))),'-NvimDir',(& $q ($NvimDir.TrimEnd('\'))))
  if ($RbmRoot) { $argList += '-RbmRoot'; $argList += (& $q ($RbmRoot.TrimEnd('\'))) }
  if ($DocsRoot) { $argList += '-DocsRoot'; $argList += (& $q ($DocsRoot.TrimEnd('\'))) }
  if ($Jdk21) { $argList += '-Jdk21'; $argList += (& $q ($Jdk21.TrimEnd('\'))) }
  if ($Python) { $argList += '-Python'; $argList += (& $q $Python) }
  if ($TrustedProjects.Count -gt 0) { $argList += '-TrustedProjects'; $argList += (($TrustedProjects | ForEach-Object { & $q $_ }) -join ',') }
  if ($SkipPlugins) { $argList += '-SkipPlugins' }
  try {
    $p = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru -ErrorAction Stop
    Say ("  관리자 실행 종료 코드: {0}. 로그: {1}" -f $p.ExitCode, (Join-Path $HomeDir '.agent-env-backup\install-last.log'))
    exit $p.ExitCode
  } catch {
    Say '  관리자 실행이 취소됐습니다. 파일은 복사로 폴백합니다(설정 › 시스템 › 개발자용 › 개발자 모드를 켜면 다음 설치부터 symlink).'
  }
}
if ($NoElevate) {
  New-Item -ItemType Directory -Force (Join-Path $HomeDir '.agent-env-backup') | Out-Null
  Start-Transcript -Path (Join-Path $HomeDir '.agent-env-backup\install-last.log') -Force | Out-Null
}
$manifestPath = Join-Path $HomeDir '.agent-env-manifest.json'
$prevManifest = Read-Manifest -Path $manifestPath
$newManifest = @{}

function Do-Link($rel, $link, $target) {
  if ($DryRun) { [void]$report.Add(@{ 대상 = $rel; 처리 = 'dry-run'; 비고 = $link }); return }
  $moved = Backup-Item -Path $link -BackupRoot $backupRoot -RelName $rel -Manifest $prevManifest
  $how = New-Link -Link $link -Target $target -CanSymlink $canSymlink
  $note = if ($moved) { "백업 → $moved" } else { '' }
  [void]$report.Add(@{ 대상 = $rel; 처리 = $how; 비고 = $note })
  $newManifest[$link] = $how
}
function Do-Template($rel, $tmpl, $out, $vars, [switch]$NoBackup) {
  if ($DryRun) { [void]$report.Add(@{ 대상 = $rel; 처리 = 'dry-run'; 비고 = $out }); return }
  $tmpOut = Join-Path $env:TEMP ('tmpl-' + [guid]::NewGuid() + '.out')
  Expand-Template -TemplatePath $tmpl -Vars $vars -OutPath $tmpOut
  # .json 은 기존 파일의 최상위 키 중 템플릿에 없는 것(CLI 가 나중에 추가한 키)을 보존한다.
  if ($out -like '*.json' -and -not (Test-IsLink $out)) {
    $kept = @(Merge-JsonExtraKeys -ExistingPath $out -NewPath $tmpOut)
    if ($kept.Count -gt 0) { Say ("  {0}: 기존 키 보존 — {1}" -f $rel, ($kept -join ', ')) }
  }
  if ((Test-Path -LiteralPath $out) -and -not (Test-IsLink $out)) {
    if ((Get-FileHash -LiteralPath $out).Hash -eq (Get-FileHash -LiteralPath $tmpOut).Hash) {
      Remove-Item -LiteralPath $tmpOut -Force
      [void]$report.Add(@{ 대상 = $rel; 처리 = 'skip(동일)'; 비고 = $out })
      # 설치 전부터 있던 사용자 파일(매니페스트에 없음)은 우리 소유로 등록하지 않는다 — uninstall 이 지우면 안 된다.
      if ($prevManifest.ContainsKey($out)) { $newManifest[$out] = '생성' }
      return
    }
    if (-not $NoBackup) { [void](Backup-Item -Path $out -BackupRoot $backupRoot -RelName $rel -Manifest $prevManifest) }
  }
  Move-Item -LiteralPath $tmpOut -Destination $out -Force
  [void]$report.Add(@{ 대상 = $rel; 처리 = '생성'; 비고 = $out })
  $newManifest[$out] = '생성'
}

# 1. ~/.claude
Say '== ~/.claude'
Do-Link '.claude\CLAUDE.md'              (Join-Path $claudeHome 'CLAUDE.md')              "$Repo\claude\CLAUDE.md"
Do-Link '.claude\agents'                 (Join-Path $claudeHome 'agents')                 "$Repo\claude\agents"
Do-Link '.claude\hooks'                  (Join-Path $claudeHome 'hooks')                  "$Repo\claude\hooks"
Do-Link '.claude\statusline-command.ps1' (Join-Path $claudeHome 'statusline-command.ps1') "$Repo\claude\statusline-command.ps1"
Do-Link '.claude\skills\agent-init'      (Join-Path $claudeHome 'skills\agent-init')      "$Repo\claude\skills\agent-init"
Do-Template '.claude\settings.json' "$Repo\claude\settings.json.tmpl" (Join-Path $claudeHome 'settings.json') @{
  CLAUDE_HOME_JSON = $claudeHome.Replace('\', '\\')
}

# 2. ~/.codex
Say '== ~/.codex'
Do-Link '.codex\AGENTS.md' (Join-Path $codexHome 'AGENTS.md') "$Repo\claude\CLAUDE.md"
foreach ($f in Get-ChildItem -LiteralPath "$Repo\codex" -Filter '*.config.toml') {
  Do-Link ".codex\$($f.Name)" (Join-Path $codexHome $f.Name) $f.FullName
}
Do-Link '.codex\CODEX-사용안내.md' (Join-Path $codexHome 'CODEX-사용안내.md') "$Repo\codex\CODEX-사용안내.md"
$trust = @($TrustedProjects) + @($HomeDir)
Do-Template '.codex\config.toml' "$Repo\codex\config.toml.tmpl" (Join-Path $codexHome 'config.toml') @{
  CLAUDE_HOME_FWD       = $claudeHome.Replace('\', '/')
  TRUSTED_PROJECTS_TOML = Get-TrustedProjectsToml -Paths $trust
}

# 3. nvim (폴더 전체 링크 + local.lua 생성)
Say '== nvim'
$jdk = Find-Jdk21 -Jdk21Arg $Jdk21
$py  = Find-Python -PythonArg $Python
Do-Template 'nvim\lua\config\local.lua' "$Repo\nvim\lua\config\local.lua.tmpl" "$Repo\nvim\lua\config\local.lua" @{
  JDK21 = $jdk.Replace('\', '/'); PYTHON = $py.Replace('\', '/')
  RBM_ROOT = $RbmRoot.Replace('\', '/'); DOCS_ROOT = $DocsRoot.Replace('\', '/')
} -NoBackup
Do-Link 'nvim' $NvimDir "$Repo\nvim"

# 4. 매니페스트 기록 — 플러그인 단계가 실패하더라도 uninstall·재실행이 성립하도록 먼저 기록한다.
if (-not $DryRun) { Write-Manifest -Path $manifestPath -Entries $newManifest }

# 5. 플러그인
if (-not $SkipPlugins) { Say '== Claude 플러그인'; Install-Plugins -PluginsJson "$Repo\claude\plugins.json" -DryRun:$DryRun }

# 6. 요약
Say ''
Say '== 결과'
$report | ForEach-Object { [pscustomobject]$_ } | Format-Table -AutoSize 대상, 처리, 비고 | Out-String | Write-Host
if (-not $DryRun -and (Test-Path -LiteralPath $backupRoot)) { Say "기존 파일 백업 위치: $backupRoot" }
Say ''
Say '사람이 할 일:'
Say '  1. claude login  /  codex login'
Say '  2. nvim 을 한 번 열어 lazy.nvim 플러그인 설치를 기다린다'
Say '  3. 개발자 모드가 꺼져 있어 복사로 폴백됐다면, 설정 > 개발자용 > 개발자 모드를 켜고 다시 실행하면 symlink 로 바뀐다'
if ($NoElevate) { Stop-Transcript | Out-Null }
