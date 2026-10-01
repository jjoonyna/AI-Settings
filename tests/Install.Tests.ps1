BeforeAll {
  $Repo = Split-Path $PSScriptRoot -Parent
  . "$Repo\scripts\lib.ps1"
  $Cap = Test-SymlinkCapable
  $Tmp = Join-Path $env:TEMP ("ai-settings-install-" + [guid]::NewGuid())
  $Home2 = Join-Path $Tmp 'home'; $Nvim2 = Join-Path $Tmp 'nvim'
  New-Item -ItemType Directory -Path $Home2 | Out-Null
  # 기존 사용자 파일을 흉내낸다(백업 대상)
  New-Item -ItemType Directory -Path "$Home2\.claude\hooks" -Force | Out-Null
  Set-Content "$Home2\.claude\CLAUDE.md" '옛 지침' -Encoding UTF8
  Set-Content "$Home2\.claude\.credentials.json" '{"secret":1}' -Encoding UTF8
  New-Item -ItemType Directory -Path $Nvim2 | Out-Null
  Set-Content "$Nvim2\init.lua" '-- 옛 nvim' -Encoding UTF8
  $run = { & "$Repo\install.ps1" -HomeDir $Home2 -NvimDir $Nvim2 -TrustedProjects @('C:\proj a','D:\x') -RbmRoot 'C:\ExRBM\rbm' -SkipPlugins -NoElevate }

  # 저장소 실제 local.lua 를 보호한다(테스트가 같은 파일을 덮어쓰고 uninstall 이 지운다).
  # Get-Content/Set-Content 는 PS5.1 기본 인코딩(ANSI 디코딩/UTF8 BOM 추가)을 거치며 바이트가 깨지므로
  # 원문 바이트를 그대로 보존·복원하도록 [IO.File]::ReadAllBytes/WriteAllBytes 를 쓴다.
  $realLocalLua = "$Repo\nvim\lua\config\local.lua"
  $hadRealLocalLua = Test-Path -LiteralPath $realLocalLua
  if ($hadRealLocalLua) { $realLocalLuaBytes = [IO.File]::ReadAllBytes($realLocalLua) }
}
AfterAll {
  # 링크를 먼저 끊어야 저장소 파일이 지워지지 않는다
  Get-ChildItem -LiteralPath $Tmp -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Delete() }
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue

  if ($hadRealLocalLua) {
    [IO.File]::WriteAllBytes($realLocalLua, $realLocalLuaBytes)
  } else {
    Remove-Item -LiteralPath $realLocalLua -Force -ErrorAction SilentlyContinue
  }
}

Describe 'install.ps1' {
  It '첫 실행: 기존 파일을 백업하고 링크·생성 파일을 만든다' {
    & $run | Out-Null
    $bk = Get-ChildItem "$Home2\.agent-env-backup" | Select-Object -First 1
    Get-Content "$($bk.FullName)\.claude\CLAUDE.md" | Should -Be '옛 지침'
    Get-Content "$($bk.FullName)\nvim\init.lua" | Should -Be '-- 옛 nvim'
    (Get-Item $Nvim2).Attributes -band [IO.FileAttributes]::ReparsePoint | Should -Not -Be 0
    Test-Path "$Nvim2\lua\config\agent\terminal.lua" | Should -BeTrue
  }
  It '지침 파일이 저장소를 가리킨다(symlink) 또는 같은 내용의 복사본이다(폴백)' {
    if ($Cap) { (Get-Item "$Home2\.claude\CLAUDE.md").LinkType | Should -Be 'SymbolicLink' }
    else      { (Get-Item "$Home2\.claude\CLAUDE.md").LinkType | Should -BeNullOrEmpty }
    Get-Content "$Home2\.claude\CLAUDE.md" -Raw | Should -Be (Get-Content "$Repo\claude\CLAUDE.md" -Raw)
    if ($Cap) { (Get-Item "$Home2\.codex\AGENTS.md").LinkType | Should -Be 'SymbolicLink' }
    else      { (Get-Item "$Home2\.codex\AGENTS.md").LinkType | Should -BeNullOrEmpty }
    Get-Content "$Home2\.codex\AGENTS.md" -Raw | Should -Be (Get-Content "$Repo\claude\CLAUDE.md" -Raw)
  }
  It '비밀 파일은 건드리지 않는다' {
    Get-Content "$Home2\.claude\.credentials.json" | Should -Be '{"secret":1}'
  }
  It '생성 파일에 경로가 치환돼 있다' {
    $s = Get-Content "$Home2\.claude\settings.json" -Raw | ConvertFrom-Json
    $s.hooks.Stop[0].hooks[0].command | Should -Be ('node "' + $Home2 + '\.claude\hooks\agent-done.js"')
    $c = Get-Content "$Home2\.codex\config.toml" -Raw
    $c | Should -Match ([regex]::Escape(($Home2 -replace '\\','/') + '/.claude/hooks/agent-done.js'))
    $c | Should -Match "\[projects\.'c:\\proj a'\]"
    $c | Should -Match "\[projects\.'d:\\x'\]"
    $l = Get-Content "$Repo\nvim\lua\config\local.lua" -Raw
    $l | Should -Match 'root = nil_or\("C:/ExRBM/rbm"\)'
  }
  It '매니페스트가 만들어지고 두 번째 실행에서 백업이 늘지 않는다' {
    Test-Path "$Home2\.agent-env-manifest.json" | Should -BeTrue
    $before = (Get-ChildItem "$Home2\.agent-env-backup").Count
    { & $run | Out-Null } | Should -Not -Throw
    (Get-ChildItem "$Home2\.agent-env-backup").Count | Should -Be $before
    Test-Path "$Repo\claude\CLAUDE.md" | Should -BeTrue   # 저장소 파일이 백업으로 이동되지 않았다
  }
  It 'CLI 가 settings.json 에 추가한 최상위 키는 재실행에도 보존되고 백업이 늘지 않는다' {
    $sp = "$Home2\.claude\settings.json"
    $s = Get-Content $sp -Raw -Encoding UTF8 | ConvertFrom-Json
    $s.extraKnownMarketplaces.'claude-plugins-official'.source.repo | Should -Be 'anthropics/claude-plugins-official'
    $s | Add-Member NoteProperty 'cliAddedKey' @{ n = 1 }
    [IO.File]::WriteAllText($sp, ($s | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding($false)))
    $before = (Get-ChildItem "$Home2\.agent-env-backup").Count
    & $run | Out-Null
    $s2 = Get-Content $sp -Raw -Encoding UTF8 | ConvertFrom-Json
    $s2.cliAddedKey.n | Should -Be 1
    $s2.hooks.Stop[0].hooks[0].command | Should -Be ('node "' + $Home2 + '\.claude\hooks\agent-done.js"')
    $h1 = (Get-FileHash $sp).Hash
    & $run | Out-Null
    (Get-FileHash $sp).Hash | Should -Be $h1
    (Get-ChildItem "$Home2\.agent-env-backup").Count | Should -Be $before
  }
  It '-DryRun 은 아무것도 바꾸지 않는다' {
    $h3 = Join-Path $Tmp 'home3'; New-Item -ItemType Directory $h3 | Out-Null
    & "$Repo\install.ps1" -HomeDir $h3 -NvimDir (Join-Path $Tmp 'nvim3') -SkipPlugins -DryRun -NoElevate | Out-Null
    Test-Path "$h3\.claude" | Should -BeFalse
  }
}

Describe '설치 전부터 있던 사용자 파일은 매니페스트에 등록하지 않는다 (F2)' {
  BeforeAll {
    $Home4 = Join-Path $Tmp 'home4'; $Nvim4 = Join-Path $Tmp 'nvim4'
    New-Item -ItemType Directory -Path "$Home4\.claude" -Force | Out-Null
    # install 이 만들 것과 바이트가 같은 settings.json 을 미리 만들어 둔다(설치 전부터 있던 파일 흉내).
    Expand-Template -TemplatePath "$Repo\claude\settings.json.tmpl" -OutPath "$Home4\.claude\settings.json" -Vars @{
      CLAUDE_HOME_JSON = (Join-Path $Home4 '.claude').Replace('\', '\\')
    }
  }
  It '설치 후 매니페스트에 등록되지 않고, uninstall 뒤에도 그대로 남는다' {
    $settingsPath = "$Home4\.claude\settings.json"
    $hashBefore = (Get-FileHash $settingsPath).Hash

    & "$Repo\install.ps1" -HomeDir $Home4 -NvimDir $Nvim4 -SkipPlugins -NoElevate | Out-Null
    $m = Get-Content "$Home4\.agent-env-manifest.json" -Raw | ConvertFrom-Json
    ($m.PSObject.Properties.Name -contains $settingsPath) | Should -BeFalse
    (Get-FileHash $settingsPath).Hash | Should -Be $hashBefore

    & "$Repo\uninstall.ps1" -HomeDir $Home4 -NvimDir $Nvim4 | Out-Null
    Test-Path $settingsPath | Should -BeTrue
    (Get-FileHash $settingsPath).Hash | Should -Be $hashBefore
  }
}

Describe 'uninstall.ps1 — 백업이 여러 개일 때' {
  It '모든 백업을 오래된 것부터 복원하고(나중 것이 덮음) 백업 폴더는 남긴다' {
    # NvimDir 이름이 nvim 이 아니어도 nvim 백업은 NvimDir 아래로 복원돼야 한다.
    # 부모(local5)는 링크가 없는 빈 폴더라 복원 경로가 틀려도 저장소에 쓰지 않는다($Tmp\nvim 은 저장소 junction 이다).
    $h5 = Join-Path $Tmp 'home5'; $n5 = Join-Path $Tmp 'local5\nvim5'
    $b1 = "$h5\.agent-env-backup\20200101-000000"; $b2 = "$h5\.agent-env-backup\20200102-000000"
    New-Item -ItemType Directory -Path "$b1\.claude", "$b2\.claude", "$b1\nvim" -Force | Out-Null
    Set-Content "$b1\.claude\a.txt" 'a-원본' -Encoding UTF8
    Set-Content "$b1\.claude\b.txt" 'b-원본' -Encoding UTF8
    Set-Content "$b1\nvim\init.lua" '-- 원본 nvim' -Encoding UTF8
    Set-Content "$b2\.claude\a.txt" 'a-나중' -Encoding UTF8
    & "$Repo\uninstall.ps1" -HomeDir $h5 -NvimDir $n5 | Out-Null
    Get-Content "$h5\.claude\a.txt" | Should -Be 'a-나중'
    Get-Content "$h5\.claude\b.txt" | Should -Be 'b-원본'
    Get-Content "$n5\init.lua" | Should -Be '-- 원본 nvim'
    Test-Path (Join-Path $Tmp 'local5\nvim') | Should -BeFalse
    Test-Path $b1 | Should -BeTrue
    Test-Path $b2 | Should -BeTrue
  }
}

Describe 'uninstall.ps1' {
  It 'uninstall 뒤 저장소 정본이 바뀌지 않는다(복사 폴백 환경 포함)' {
    $hash = (Get-FileHash "$Repo\claude\CLAUDE.md").Hash
    & "$Repo\uninstall.ps1" -HomeDir $Home2 -NvimDir $Nvim2 | Out-Null
    (Get-FileHash "$Repo\claude\CLAUDE.md").Hash | Should -Be $hash
    Get-Content "$Home2\.claude\CLAUDE.md" | Should -Be '옛 지침'
    (Get-Item "$Home2\.claude\CLAUDE.md").Attributes -band [IO.FileAttributes]::ReparsePoint | Should -Be 0
    Get-Content "$Nvim2\init.lua" | Should -Be '-- 옛 nvim'
    Test-Path "$Repo\claude\CLAUDE.md" | Should -BeTrue
  }
}
