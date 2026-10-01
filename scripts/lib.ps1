# scripts/lib.ps1 — install.ps1 / uninstall.ps1 가 dot-source 하는 함수 모음 (Windows PowerShell 5.1)
Set-StrictMode -Version 2.0

function Expand-Template {
  param(
    [Parameter(Mandatory)][string]$TemplatePath,
    [Parameter(Mandatory)][hashtable]$Vars,
    [Parameter(Mandatory)][string]$OutPath
  )
  $text = [IO.File]::ReadAllText($TemplatePath, [Text.Encoding]::UTF8)
  foreach ($k in $Vars.Keys) {
    $text = $text.Replace('{{' + $k + '}}', [string]$Vars[$k])
  }
  $left = [regex]::Matches($text, '\{\{[A-Z0-9_]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
  if ($left) { throw ("치환되지 않은 변수: " + ($left -join ', ') + " (" + $TemplatePath + ")") }
  $dir = Split-Path -Parent $OutPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $utf8NoBom = New-Object Text.UTF8Encoding($false)
  if (-not $text.EndsWith("`n")) { $text += "`r`n" }
  [IO.File]::WriteAllText($OutPath, $text, $utf8NoBom)
}

# .json 생성 파일의 얕은 병합: 기존 파일($ExistingPath)의 최상위 키 중 새 파일($NewPath)에 없는 것을
# 새 파일 끝에 덧붙인다(템플릿 키가 우선, CLI 가 나중에 추가한 키는 유지). 템플릿 부분의 텍스트는 그대로 두므로
# 재실행해도 결과가 같다(멱등). 기존 파일이 없거나 JSON 이 아니면 아무것도 하지 않는다. 덧붙인 키 이름 배열을 반환한다.
function Merge-JsonExtraKeys {
  param([Parameter(Mandatory)][string]$ExistingPath, [Parameter(Mandatory)][string]$NewPath)
  if (-not (Test-Path -LiteralPath $ExistingPath)) { return @() }
  try { $old = [IO.File]::ReadAllText($ExistingPath, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return @() }
  if ($null -eq $old -or $old -isnot [pscustomobject]) { return @() }
  $text = [IO.File]::ReadAllText($NewPath, [Text.Encoding]::UTF8)
  $new = $text | ConvertFrom-Json
  $newKeys = @($new.PSObject.Properties | ForEach-Object { $_.Name })
  $extra = @($old.PSObject.Properties | Where-Object { $newKeys -notcontains $_.Name })
  if ($extra.Count -eq 0) { return @() }
  $end = $text.LastIndexOf('}')
  $body = $text.Substring(0, $end).TrimEnd()
  foreach ($p in $extra) {
    $val = (ConvertTo-Json -InputObject $p.Value -Depth 32) -replace "`r?`n", "`r`n  "
    $sep = if ($body.EndsWith('{')) { '' } else { ',' }
    $body += $sep + "`r`n  " + (ConvertTo-Json -InputObject $p.Name) + ': ' + $val
  }
  $utf8NoBom = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($NewPath, $body + "`r`n}`r`n", $utf8NoBom)
  return @($extra | ForEach-Object { $_.Name })
}

function Test-IsLink {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Test-SymlinkCapable {
  $f = Join-Path $env:TEMP ('symtest-' + [guid]::NewGuid() + '.txt'); $l = "$f.lnk"
  Set-Content -LiteralPath $f -Value 'x'
  try { New-Item -ItemType SymbolicLink -Path $l -Target $f -ErrorAction Stop | Out-Null; Remove-Item -LiteralPath $l -Force; return $true }
  catch { return $false }
  finally { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
}

function Read-Manifest { param([string]$Path)
  $m = @{}
  if (Test-Path -LiteralPath $Path) {
    $j = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $j.PSObject.Properties) { $m[$p.Name] = $p.Value }
  }
  return $m
}
function Write-Manifest { param([string]$Path, [hashtable]$Entries)
  $o = New-Object PSObject
  foreach ($k in ($Entries.Keys | Sort-Object)) { $o | Add-Member NoteProperty $k $Entries[$k] }
  $o | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding UTF8
}

# 기존 실제 파일/폴더를 BackupRoot 아래 같은 상대 구조로 이동한다.
# 없거나 이미 링크거나 매니페스트에 있으면(이전 설치가 만든 것) $null.
function Backup-Item {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$BackupRoot,
        [Parameter(Mandatory)][string]$RelName, [hashtable]$Manifest = @{})
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  if (Test-IsLink $Path) { return $null }
  if ($Manifest.ContainsKey($Path)) { return $null }
  $dest = Join-Path $BackupRoot $RelName
  $parent = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Move-Item -LiteralPath $Path -Destination $dest -Force
  return $dest
}

# 링크를 만든다. symlink → (폴더) junction / (파일) 복사. hardlink 는 쓰지 않는다.
function New-Link {
  param([Parameter(Mandatory)][string]$Link, [Parameter(Mandatory)][string]$Target, [bool]$CanSymlink = $true)
  if (Test-IsLink $Link) { return 'skip(이미 링크)' }
  $isDir = (Get-Item -LiteralPath $Target).PSIsContainer
  if ((Test-Path -LiteralPath $Link) -and -not $isDir) {
    # 이전 설치의 복사본이면 내용이 같을 때 건너뛰고, 다르면 갱신한다.
    if ((Get-FileHash -LiteralPath $Link).Hash -eq (Get-FileHash -LiteralPath $Target).Hash) { return 'skip(동일 복사본)' }
    Remove-Item -LiteralPath $Link -Force
  } elseif (Test-Path -LiteralPath $Link) {
    throw "링크 위치에 실제 폴더가 남아 있습니다(백업 실패?): $Link"
  }
  $parent = Split-Path -Parent $Link
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  if ($CanSymlink) {
    try { New-Item -ItemType SymbolicLink -Path $Link -Target $Target -ErrorAction Stop | Out-Null; return 'symlink' } catch { }
  }
  if ($isDir) { New-Item -ItemType Junction -Path $Link -Target $Target -ErrorAction Stop | Out-Null; return 'junction' }
  Copy-Item -LiteralPath $Target -Destination $Link -Force
  return 'copy'
}

# JDK 21 경로를 찾는다. 우선순위:
# ① -Jdk21Arg(install.ps1 의 -Jdk21 인자) — 존재 확인만 하고 그대로 채택
# ② -ProgramFilesJdk21(기본 C:\Program Files\Java\jdk-21) — 존재하면 채택
# ③ -JavaHome(기본 $env:JAVA_HOME) — release 파일에서 JAVA_VERSION="21 로 시작하는 줄이 있을 때만 채택
# ④ 그 외 ''
# ②·③ 은 매개변수로 주입 가능해 테스트에서 실제 Program Files/환경변수에 의존하지 않고 검사한다.
function Find-Jdk21 {
  param(
    [string]$Jdk21Arg = '',
    [string]$ProgramFilesJdk21 = 'C:\Program Files\Java\jdk-21',
    [string]$JavaHome = $env:JAVA_HOME
  )
  if ($Jdk21Arg -and (Test-Path -LiteralPath $Jdk21Arg)) { return $Jdk21Arg }
  if ($ProgramFilesJdk21 -and (Test-Path -LiteralPath $ProgramFilesJdk21)) { return $ProgramFilesJdk21 }
  if ($JavaHome -and (Test-Path -LiteralPath $JavaHome)) {
    $release = Join-Path $JavaHome 'release'
    if (Test-Path -LiteralPath $release) {
      $lines = Get-Content -LiteralPath $release -ErrorAction SilentlyContinue
      if ($lines | Where-Object { $_ -match '^JAVA_VERSION="21' }) { return $JavaHome }
    }
  }
  return ''
}

# python.exe 경로를 찾는다. 우선순위:
# ① -PythonArg(install.ps1 의 -Python 인자) — 존재하면 채택
# ② -LocalProgramsRoot(기본 %LOCALAPPDATA%\Programs\Python) 아래 Python3*\python.exe 중 가장 높은 버전
# ③ -PyLauncher(기본 py -c "import sys;print(sys.executable)") 의 출력이 실제 파일이면 채택
# ④ -Candidates(기본 PATH 의 python) 중 Microsoft Store 별칭 스텁(...\WindowsApps\python.exe)이 아닌 첫 번째
# ⑤ 그 외 ''
# ②~④ 는 매개변수로 주입 가능해 테스트에서 실제 설치 상태에 의존하지 않고 검사한다.
function Find-Python {
  param(
    [string]$PythonArg = '',
    [string]$LocalProgramsRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
    [scriptblock]$PyLauncher = {
      if (Get-Command py -ErrorAction SilentlyContinue) { & py -c "import sys;print(sys.executable)" 2>$null }
    },
    [string[]]$Candidates
  )
  if ($PythonArg -and (Test-Path -LiteralPath $PythonArg)) { return $PythonArg }
  if ($LocalProgramsRoot -and (Test-Path -LiteralPath $LocalProgramsRoot)) {
    $best = Get-ChildItem -LiteralPath $LocalProgramsRoot -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^Python3(\d+)' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'python.exe')) } |
      Sort-Object { [int]([regex]::Match($_.Name, '^Python3(\d+)').Groups[1].Value) } -Descending |
      Select-Object -First 1
    if ($best) { return (Join-Path $best.FullName 'python.exe') }
  }
  if ($PyLauncher) {
    $out = $null
    try { $out = @(& $PyLauncher) | Select-Object -First 1 } catch { $out = $null }
    if ($out) {
      $out = ([string]$out).Trim()
      if ($out -and $out -notmatch '\\WindowsApps\\' -and (Test-Path -LiteralPath $out)) { return $out }
    }
  }
  if (-not $PSBoundParameters.ContainsKey('Candidates')) {
    $Candidates = @(Get-Command python -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
  }
  foreach ($c in $Candidates) {
    if (-not $c) { continue }
    if ($c -match '\\WindowsApps\\') { continue }
    return $c
  }
  return ''
}

# Codex trust 블록 문자열. 경로는 Codex 가 쓰는 형태(소문자, 백슬래시)로 정규화한다.
function Get-TrustedProjectsToml {
  param([string[]]$Paths)
  $blocks = foreach ($p in $Paths) {
    if (-not $p) { continue }
    $n = $p.TrimEnd('\').ToLowerInvariant()
    "[projects.'$n']`r`ntrust_level = `"trusted`""
  }
  return ($blocks -join "`r`n`r`n")
}

function Install-Plugins {
  param([Parameter(Mandatory)][string]$PluginsJson, [switch]$DryRun)
  # 네이티브 명령(claude)의 stderr 한 줄이 $ErrorActionPreference='Stop' 상속 때문에
  # install 전체를 죽이지 않도록 이 함수 안에서만 지역적으로 'Continue' 로 둔다.
  $ErrorActionPreference = 'Continue'
  $p = Get-Content -LiteralPath $PluginsJson -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($m in $p.marketplaces.PSObject.Properties) {
    Write-Host ("  마켓플레이스 등록: {0} ← {1}" -f $m.Name, $m.Value)
    if (-not $DryRun) {
      & claude plugin marketplace add $m.Value 2>&1 | ForEach-Object { "$_" } | Out-Host
      if ($LASTEXITCODE -ne 0) { Write-Host ("  경고: 마켓플레이스 등록 실패 (종료 코드 {0})" -f $LASTEXITCODE) }
    }
  }
  foreach ($name in $p.plugins) {
    Write-Host ("  플러그인 설치: {0}" -f $name)
    if (-not $DryRun) {
      & claude plugin install $name 2>&1 | ForEach-Object { "$_" } | Out-Host
      if ($LASTEXITCODE -ne 0) { Write-Host ("  경고: 플러그인 설치 실패 - {0} (종료 코드 {1})" -f $name, $LASTEXITCODE) }
    }
  }
}
