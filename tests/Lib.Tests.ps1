BeforeAll {
  $Repo = Split-Path $PSScriptRoot -Parent
  . "$Repo\scripts\lib.ps1"
  $Tmp = Join-Path $env:TEMP ("ai-settings-test-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $Tmp | Out-Null
}
AfterAll { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }

Describe 'Expand-Template' {
  It '{{KEY}} 를 치환하고 BOM 없는 UTF-8 로 쓴다' {
    $t = Join-Path $Tmp 'a.tmpl'; $o = Join-Path $Tmp 'a.out'
    Set-Content -LiteralPath $t -Value 'x={{A}} y={{B}}' -Encoding UTF8
    Expand-Template -TemplatePath $t -Vars @{ A = '1'; B = 'two' } -OutPath $o
    Get-Content -LiteralPath $o -Raw | Should -Be "x=1 y=two`r`n"
    $bytes = [IO.File]::ReadAllBytes($o)
    ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB) | Should -BeFalse
  }
  It '치환되지 않은 변수가 남으면 throw' {
    $t = Join-Path $Tmp 'b.tmpl'; $o = Join-Path $Tmp 'b.out'
    Set-Content -LiteralPath $t -Value 'x={{MISSING}}' -Encoding UTF8
    { Expand-Template -TemplatePath $t -Vars @{} -OutPath $o } | Should -Throw '*MISSING*'
  }
  It 'settings.json.tmpl 치환 결과가 올바른 JSON 이고 경로가 들어간다' {
    $o = Join-Path $Tmp 'settings.json'
    $claudeHomeT = 'C:\Users\tester\.claude'
    Expand-Template -TemplatePath "$Repo\claude\settings.json.tmpl" -OutPath $o -Vars @{
      CLAUDE_HOME_JSON = $claudeHomeT.Replace('\', '\\')
    }
    $j = Get-Content -LiteralPath $o -Raw | ConvertFrom-Json
    $j.hooks.Stop[0].hooks[0].command | Should -Be 'node "C:\Users\tester\.claude\hooks\agent-done.js"'
    $j.statusLine.command | Should -Match 'C:\\Users\\tester\\\.claude\\statusline-command\.ps1'
    $j.language | Should -Be 'Korea'
    $j.tui | Should -Be 'fullscreen'
  }
  It 'config.toml.tmpl 치환 결과에 notify 와 trust 블록이 들어간다' {
    $o = Join-Path $Tmp 'config.toml'
    Expand-Template -TemplatePath "$Repo\codex\config.toml.tmpl" -OutPath $o -Vars @{
      CLAUDE_HOME_FWD = 'C:/Users/tester/.claude'
      TRUSTED_PROJECTS_TOML = "[projects.'c:\proj']`r`ntrust_level = `"trusted`""
    }
    $c = Get-Content -LiteralPath $o -Raw
    $c | Should -Match 'notify = \["node", "C:/Users/tester/\.claude/hooks/agent-done\.js", "--codex"\]'
    $c | Should -Match "\[projects\.'c:\\proj'\]"
    $c | Should -Match 'sandbox = "unelevated"'
  }
  It '한글 주석을 그대로 남기고 BOM 없이 쓴다' {
    $t = Join-Path $Tmp 'kor.tmpl'; $o = Join-Path $Tmp 'kor.out'
    $firstLine = '-- 머신 종속 설정. install.ps1 이 local.lua.tmpl 에서 생성한다.'
    $src = $firstLine + "`r`n" + 'x = "{{A}}"' + "`r`n"
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($t, $src, $utf8NoBom)

    Expand-Template -TemplatePath $t -Vars @{ A = '1' } -OutPath $o

    $outText = [IO.File]::ReadAllText($o, [Text.Encoding]::UTF8)
    ($outText -split "`r`n")[0] | Should -Be $firstLine
    $bytes = [IO.File]::ReadAllBytes($o)
    ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) | Should -BeFalse
  }
  It '저장소 local.lua.tmpl 자체를 치환해도 첫 줄 한글 주석이 템플릿과 같다' {
    $tmplPath = "$Repo\nvim\lua\config\local.lua.tmpl"
    $o = Join-Path $Tmp 'local.lua.out'
    Expand-Template -TemplatePath $tmplPath -OutPath $o -Vars @{
      JDK21 = ''; PYTHON = ''; RBM_ROOT = ''; DOCS_ROOT = ''
    }
    $srcFirstLine = ([IO.File]::ReadAllText($tmplPath, [Text.Encoding]::UTF8) -split "`r`n|`n")[0]
    $outFirstLine = ([IO.File]::ReadAllText($o, [Text.Encoding]::UTF8) -split "`r`n|`n")[0]
    $outFirstLine | Should -Be $srcFirstLine
  }
}

Describe 'Find-Jdk21' {
  BeforeAll {
    # JAVA_HOME 역할을 할 가짜 1.6 폴더와 21 폴더, Program Files 역할을 할 가짜 폴더를 준비한다.
    $jh16 = Join-Path $Tmp 'javahome-1.6'; New-Item -ItemType Directory -Path $jh16 -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $jh16 'release') -Value 'JAVA_VERSION="1.6.0_45"' -Encoding UTF8

    $jh21 = Join-Path $Tmp 'javahome-21'; New-Item -ItemType Directory -Path $jh21 -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $jh21 'release') -Value 'JAVA_VERSION="21.0.2"' -Encoding UTF8

    $pf21 = Join-Path $Tmp 'programfiles-jdk-21'; New-Item -ItemType Directory -Path $pf21 -Force | Out-Null

    $argPath = Join-Path $Tmp 'explicit-jdk21-arg'; New-Item -ItemType Directory -Path $argPath -Force | Out-Null
    $noSuch = Join-Path $Tmp 'no-such-dir'
  }
  It '-Jdk21Arg 가 존재하면(버전 확인 없이) 최우선으로 채택한다' {
    Find-Jdk21 -Jdk21Arg $argPath -ProgramFilesJdk21 $pf21 -JavaHome $jh21 | Should -Be $argPath
  }
  It 'Program Files 후보가 있으면 JAVA_HOME 보다 우선한다' {
    Find-Jdk21 -Jdk21Arg '' -ProgramFilesJdk21 $pf21 -JavaHome $jh21 | Should -Be $pf21
  }
  It 'Program Files 후보가 없으면 JAVA_HOME 을 보되, JDK 21 일 때만 채택한다' {
    Find-Jdk21 -Jdk21Arg '' -ProgramFilesJdk21 $noSuch -JavaHome $jh21 | Should -Be $jh21
    Find-Jdk21 -Jdk21Arg '' -ProgramFilesJdk21 $noSuch -JavaHome $jh16 | Should -Be ''
  }
  It '아무 후보도 없으면 빈 문자열' {
    Find-Jdk21 -Jdk21Arg '' -ProgramFilesJdk21 $noSuch -JavaHome '' | Should -Be ''
  }
}

Describe 'Merge-JsonExtraKeys' {
  BeforeEach {
    $new = Join-Path $Tmp 'merge-new.json'; $old = Join-Path $Tmp 'merge-old.json'
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($new, "{`r`n  `"model`": `"opus`",`r`n  `"language`": `"Korea`"`r`n}`r`n", $utf8NoBom)
  }
  It '기존 파일의 추가 최상위 키를 보존하고 템플릿 키는 템플릿 값이 이긴다' {
    [IO.File]::WriteAllText($old, '{"model":"sonnet","extraKnownMarketplaces":{"m":{"source":{"source":"github","repo":"a/b"}}},"feedbackSurveyState":{"n":3}}', $utf8NoBom)
    $kept = @(Merge-JsonExtraKeys -ExistingPath $old -NewPath $new)
    $kept | Should -Be @('extraKnownMarketplaces', 'feedbackSurveyState')
    $j = [IO.File]::ReadAllText($new, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $j.model | Should -Be 'opus'
    $j.language | Should -Be 'Korea'
    $j.extraKnownMarketplaces.m.source.repo | Should -Be 'a/b'
    $j.feedbackSurveyState.n | Should -Be 3
    $bytes = [IO.File]::ReadAllBytes($new)
    ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB) | Should -BeFalse
  }
  It '병합 결과를 다시 기존 파일로 삼아 병합해도 바이트가 같다(멱등)' {
    [IO.File]::WriteAllText($old, '{"extra":{"k":[1,2]}}', $utf8NoBom)
    $tmplText = [IO.File]::ReadAllText($new)
    Merge-JsonExtraKeys -ExistingPath $old -NewPath $new | Out-Null
    $first = [IO.File]::ReadAllText($new)
    Copy-Item -LiteralPath $new -Destination $old -Force
    [IO.File]::WriteAllText($new, $tmplText, $utf8NoBom)
    Merge-JsonExtraKeys -ExistingPath $old -NewPath $new | Out-Null
    [IO.File]::ReadAllText($new) | Should -Be $first
  }
  It '기존 파일이 없거나 JSON 이 아니면 새 파일을 건드리지 않는다' {
    $before = [IO.File]::ReadAllText($new)
    @(Merge-JsonExtraKeys -ExistingPath (Join-Path $Tmp 'none.json') -NewPath $new).Count | Should -Be 0
    [IO.File]::WriteAllText($old, 'not json', $utf8NoBom)
    @(Merge-JsonExtraKeys -ExistingPath $old -NewPath $new).Count | Should -Be 0
    [IO.File]::ReadAllText($new) | Should -Be $before
  }
}

Describe 'Find-Python' {
  BeforeAll {
    $noSuchPy = Join-Path $Tmp 'no-such-python-root'
    $noPy = { $null }
    $pyRoot = Join-Path $Tmp 'Programs-Python'
    foreach ($v in 'Python39', 'Python311', 'Python313-32', 'Python312') {
      New-Item -ItemType Directory -Path (Join-Path $pyRoot $v) -Force | Out-Null
    }
    foreach ($v in 'Python39', 'Python311', 'Python312') {
      Set-Content -LiteralPath (Join-Path $pyRoot "$v\python.exe") -Value 'x'
    }
    # Python313-32 는 폴더만 있고 python.exe 가 없다 → 후보 아님
    $argPy = Join-Path $Tmp 'explicit-python.exe'; Set-Content -LiteralPath $argPy -Value 'x'
    $launcherPy = Join-Path $Tmp 'launcher-python.exe'; Set-Content -LiteralPath $launcherPy -Value 'x'
  }
  It '-PythonArg 가 존재하면 최우선으로 채택한다' {
    Find-Python -PythonArg $argPy -LocalProgramsRoot $pyRoot -PyLauncher $noPy -Candidates @() | Should -Be $argPy
  }
  It '%LOCALAPPDATA%\Programs\Python 아래 python.exe 가 있는 가장 높은 버전을 고른다' {
    Find-Python -LocalProgramsRoot $pyRoot -PyLauncher $noPy -Candidates @() | Should -Be (Join-Path $pyRoot 'Python312\python.exe')
  }
  It 'Programs 에 없으면 py 런처의 출력(실제 파일)을 쓴다' {
    $launcher = [scriptblock]::Create("'$launcherPy'")
    Find-Python -LocalProgramsRoot $noSuchPy -PyLauncher $launcher -Candidates @() | Should -Be $launcherPy
    $bad = { 'C:\no\such\python.exe' }
    Find-Python -LocalProgramsRoot $noSuchPy -PyLauncher $bad -Candidates @() | Should -Be ''
  }
  It 'WindowsApps 별칭 스텁은 건너뛰고 첫 실제 설치본을 쓴다' {
    $stub = 'C:\Users\tester\AppData\Local\Microsoft\WindowsApps\python.exe'
    $real = 'C:\Users\tester\AppData\Local\Programs\Python\Python311\python.exe'
    Find-Python -LocalProgramsRoot $noSuchPy -PyLauncher $noPy -Candidates @($stub, $real) | Should -Be $real
    Find-Python -LocalProgramsRoot $noSuchPy -PyLauncher $noPy -Candidates @($stub) | Should -Be ''
    Find-Python -LocalProgramsRoot $noSuchPy -PyLauncher $noPy -Candidates @() | Should -Be ''
  }
}

Describe 'Install-Plugins' {
  It '가짜 claude 가 stderr 를 내고 비0 종료해도 throw 하지 않는다' {
    $fakeBin = Join-Path $Tmp 'fakebin'
    New-Item -ItemType Directory -Path $fakeBin -Force | Out-Null
    # '@echo 경고 1>&2' + '@exit /b 1' — stderr 한 줄 + 비0 종료 코드
    Set-Content -LiteralPath (Join-Path $fakeBin 'claude.cmd') -Value "@echo 경고 1>&2`r`n@exit /b 1`r`n" -Encoding Default
    $oldPath = $env:PATH
    $env:PATH = "$fakeBin;$oldPath"
    try {
      { Install-Plugins -PluginsJson "$Repo\claude\plugins.json" } | Should -Not -Throw
    } finally {
      $env:PATH = $oldPath
    }
  }
}
