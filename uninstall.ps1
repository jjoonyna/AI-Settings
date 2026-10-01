<# AI-Settings 링크를 제거하고 모든 백업을 오래된 것부터 차례로 복원한다. #>
[CmdletBinding()]
param(
  [string]$HomeDir = $env:USERPROFILE,
  [string]$NvimDir = (Join-Path $env:LOCALAPPDATA 'nvim')
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\lib.ps1"

$manifestPath = Join-Path $HomeDir '.agent-env-manifest.json'
$m = Read-Manifest -Path $manifestPath
foreach ($p in $m.Keys) {
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $item = Get-Item -LiteralPath $p -Force
  if ($item.PSIsContainer -and (Test-IsLink $p)) { $item.Delete() }       # 폴더 링크: 링크만 제거
  elseif ($item.PSIsContainer) { throw "매니페스트의 폴더가 링크가 아닙니다. 수동 확인 필요: $p" }
  else { Remove-Item -LiteralPath $p -Force }                              # 파일 링크·복사본·생성 파일
  Write-Host "제거: $p ($($m[$p]))"
}
Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue

# 백업 폴더를 오래된 것부터 차례로 복원한다(같은 파일은 나중 백업이 덮는다). 백업 폴더는 지우지 않는다.
$bkRoot = Join-Path $HomeDir '.agent-env-backup'
$all = @(Get-ChildItem -LiteralPath $bkRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
foreach ($bk in $all) {
  Get-ChildItem -LiteralPath $bk.FullName -Recurse -Force -File | ForEach-Object {
    $rel = $_.FullName.Substring($bk.FullName.Length + 1)
    # nvim 백업(nvim\...)은 NvimDir 자체 아래로 복원한다(NvimDir 폴더 이름이 nvim 이 아니어도 그 밖에 쓰지 않는다).
    $dest = if ($rel -like 'nvim\*') { Join-Path $NvimDir $rel.Substring(5) } else { Join-Path $HomeDir $rel }
    $parent = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  }
  Write-Host "복원: $($bk.FullName)"
}
if ($all.Count -eq 0) { Write-Host '복원할 백업이 없습니다.' }
