param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
$data = Get-Content -LiteralPath $Request -Raw -Encoding UTF8 | ConvertFrom-Json
function Quote-Argument([string]$Value) {
  '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
if ($data.action -eq 'server') {
  $env:NVIM = $null
  $env:NVIM_LISTEN_ADDRESS = $null
  $env:AGENT_HUB_INSTANCE = $data.instance
  $env:AGENT_HUB_MANAGED = '1'
  $env:AGENT_HUB_WINDOW = $data.window
  $env:AGENT_HUB_REQUEST = $Request
  $env:AGENT_HUB_HOME = $data.root
  $env:AGENT_HUB_PREVIEW = $null
  $arguments = @('--headless','--listen',$data.server,'-u',$data.init)
  $line = ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
  $server = Start-Process -FilePath $data.nvim -ArgumentList $line -WorkingDirectory $data.cwd -WindowStyle Hidden -PassThru
  @{pid=$server.Id} | ConvertTo-Json -Compress
} else {
  throw '지원하지 않는 실행 요청입니다'
}
