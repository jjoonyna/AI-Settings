# Claude Code statusLine 스크립트 (PowerShell)
# stdin으로 JSON을 받아 모델명 / 현재 디렉터리 / git 브랜치 / 변경 파일 수 / 컨텍스트 사용률을 출력한다.

$raw = [Console]::In.ReadToEnd()
$data = $raw | ConvertFrom-Json

$model = $data.model.display_name
$cwd = $data.workspace.current_dir
if (-not $cwd) { $cwd = $data.cwd }

# 홈 디렉터리는 ~ 로 치환하고, 경로가 길면 마지막 2단계만 표시
$homeDir = $HOME
$displayPath = $cwd
if ($cwd -and $homeDir -and $cwd.StartsWith($homeDir)) {
    $displayPath = "~" + $cwd.Substring($homeDir.Length)
}
$parts = $displayPath -split '[\\/]' | Where-Object { $_ -ne '' }
if ($parts.Count -gt 2) {
    $shortPath = "..\" + ($parts[($parts.Count - 2)..($parts.Count - 1)] -join '\')
} else {
    $shortPath = $displayPath
}

# git 브랜치 / 변경 파일 수 (optional lock 생략으로 다른 git 프로세스와 충돌 방지)
$branch = $null
$changeCount = 0
if ($cwd -and (Test-Path $cwd)) {
    Push-Location $cwd
    try {
        $branch = (git --no-optional-locks branch --show-current 2>$null)
        if ($branch) {
            $statusOut = git --no-optional-locks status --porcelain 2>$null
            if ($statusOut) {
                $changeCount = @($statusOut).Count
            }
        }
    } catch {
        $branch = $null
    } finally {
        Pop-Location
    }
}

# 컨텍스트 사용률
$used = $data.context_window.used_percentage

# ANSI 색상 (터미널 dim 색상에 맞춰 은은하게)
$esc = [char]27
$reset = "$esc[0m"
$cCyan = "$esc[2;36m"
$cDim = "$esc[2;37m"
$cGreen = "$esc[2;32m"
$cYellow = "$esc[2;33m"
$cMagenta = "$esc[2;35m"

$segments = New-Object System.Collections.Generic.List[string]
$segments.Add("$cCyan$model$reset")
$segments.Add("$cDim$shortPath$reset")

if ($branch) {
    $gitSeg = "$cGreen$branch$reset"
    if ($changeCount -gt 0) {
        $gitSeg = "$gitSeg $cYellow*$changeCount$reset"
    }
    $segments.Add($gitSeg)
}

if ($null -ne $used) {
    $usedFmt = [math]::Round([double]$used)
    $segments.Add("$cMagenta Ctx:$usedFmt%$reset")
}

$separator = "$cDim |$reset "
Write-Output ([string]::Join($separator, $segments))
