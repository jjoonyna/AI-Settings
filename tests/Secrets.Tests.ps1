BeforeAll { $Repo = Split-Path $PSScriptRoot -Parent }

Describe '저장소 내용 검사' {
  It '비밀·런타임 파일이 저장소에 없다' {
    $bad = Get-ChildItem -LiteralPath $Repo -Recurse -Force -File |
      Where-Object { $_.FullName -notmatch '\\\.git\\|\\\.tools\\' } |
      Where-Object { $_.Name -match '^(\.credentials\.json|auth\.json|history\.jsonl|installed_plugins\.json|known_marketplaces\.json)$' -or $_.Extension -eq '.key' }
    $bad | Should -BeNullOrEmpty
  }
  It '전역 지침 정본이 하나만 있다' {
    Test-Path -LiteralPath "$Repo\claude\CLAUDE.md" | Should -BeTrue
    Test-Path -LiteralPath "$Repo\codex\AGENTS.md" | Should -BeFalse
  }
  It '서브에이전트 5개와 Codex 프로필 7개가 있다' {
    (Get-ChildItem -LiteralPath "$Repo\claude\agents" -Filter *.md).Count | Should -Be 5
    (Get-ChildItem -LiteralPath "$Repo\codex" -Filter *.config.toml).Count | Should -Be 7
  }
  It 'plugins.json 이 중복 Superpowers 없이 2개 플러그인을 선언한다' {
    $p = Get-Content -LiteralPath "$Repo\claude\plugins.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $p.plugins.Count | Should -Be 2
    $p.marketplaces.'claude-plugins-official' | Should -Be 'anthropics/claude-plugins-official'
  }
  It '역할 프로필은 모델을 고정하지 않고 중앙 목록을 사용한다' {
    foreach ($f in Get-ChildItem "$Repo\codex" -Filter '*.config.toml') {
      (Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8) | Should -Not -Match '(?m)^model\s*='
    }
    $catalog = Get-Content "$Repo\runtime\models.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $catalog.defaults.claude | Should -Be 'opus'
    $catalog.defaults.codex | Should -Be 'gpt-6.1-sol'
  }
}
