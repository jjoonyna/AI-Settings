# Claude sends structured status data on stdin. No credentials or extra API calls.
$raw = [Console]::In.ReadToEnd()
$runtimeRoot = if ($env:AI_SETTINGS_HOME) { $env:AI_SETTINGS_HOME } else { Join-Path (Split-Path $PSScriptRoot -Parent) '.ai-settings' }
$scriptPath = Join-Path $runtimeRoot 'bin/statusline.mjs'
if (Test-Path -LiteralPath $scriptPath) { $raw | & node $scriptPath }
else { Write-Output 'model ? | Ctx ? | 5h ? | 7d ?' }
