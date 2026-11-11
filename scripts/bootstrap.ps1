# Prerequisites for the Windows installer. Existing commands are never reinstalled.
function Update-InstallerPath {
  $parts = @([Environment]::GetEnvironmentVariable('Path','Machine'), [Environment]::GetEnvironmentVariable('Path','User'), $env:Path,
    (Join-Path $env:APPDATA 'npm'), (Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Links'),
    (Join-Path $env:USERPROFILE '.local/bin'), (Join-Path $env:ProgramFiles 'Neovim/bin'),
    (Join-Path $env:ProgramFiles 'nodejs'))
  $env:Path = (($parts | Where-Object { $_ }) -split ';' | Where-Object { $_ } | Select-Object -Unique) -join ';'
}
function Install-WingetDependency([string]$Command, [string]$Package, [switch]$DryRun) {
  $wasAvailable = [bool](Get-Command $Command -ErrorAction SilentlyContinue)
  Update-InstallerPath
  $existing = Get-Command $Command -ErrorAction SilentlyContinue
  if ($existing) {
    if (-not $wasAvailable -and -not $DryRun) {
      $commandDir = Split-Path -Parent $existing.Source
      $userPath = [string][Environment]::GetEnvironmentVariable('Path','User')
      if ($commandDir -and (@($userPath -split ';') -notcontains $commandDir)) { [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $commandDir).TrimStart(';'), 'User') }
    }
    return
  }
  Write-Host "Installing prerequisite: $Command ($Package)"
  if ($DryRun) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is required to install $Package. Install Windows App Installer, then rerun install.cmd." }
  & winget install --id $Package --exact --source winget --silent --accept-package-agreements --accept-source-agreements
  $installExit = $LASTEXITCODE
  Update-InstallerPath
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "Cannot start $Command after installing $Package (exit $installExit). Reopen the terminal and rerun install.cmd." }
}
function Initialize-Prerequisites([string]$Mode, [switch]$DryRun, [switch]$SkipTools, [string]$PythonArg) {
  Install-WingetDependency 'git' 'Git.Git' -DryRun:$DryRun
  Install-WingetDependency 'node' 'OpenJS.NodeJS.LTS' -DryRun:$DryRun
  Install-WingetDependency 'nvim' 'Neovim.Neovim' -DryRun:$DryRun
  Install-WingetDependency 'wt' 'Microsoft.WindowsTerminal' -DryRun:$DryRun
  if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing Codex CLI'
    if (-not $DryRun) {
      & npm.cmd install --global '@openai/codex'
      if ($LASTEXITCODE -ne 0) { throw 'Codex CLI install failed' }
      Update-InstallerPath
    }
  }
  if ($Mode -eq 'both') { Install-WingetDependency 'claude' 'Anthropic.ClaudeCode' -DryRun:$DryRun }
  if (-not $SkipTools -and -not (Find-Python -PythonArg $PythonArg)) {
    Write-Host 'Installing Python for design/PPT tools'
    if (-not $DryRun) {
      if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Python 3.11+ or use -Python <python.exe>.' }
      & winget install --id Python.Python.3.12 --exact --source winget --silent --accept-package-agreements --accept-source-agreements
      $installExit = $LASTEXITCODE
      Update-InstallerPath
      if (-not (Find-Python -PythonArg $PythonArg)) { throw "Python install failed or no real interpreter found (exit $installExit)" }
    }
  }
}
