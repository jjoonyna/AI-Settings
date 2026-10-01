BeforeAll { $Repo = Split-Path $PSScriptRoot -Parent }

Describe '저장소 내용 검사' {
  It '비밀·런타임 파일이 저장소에 없다' {
    $bad = Get-ChildItem -LiteralPath $Repo -Recurse -Force -File |
      Where-Object { $_.FullName -notmatch '\\\.git\\' } |
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
  It 'plugins.json 이 3개 플러그인을 선언한다' {
    $p = Get-Content -LiteralPath "$Repo\claude\plugins.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $p.plugins.Count | Should -Be 3
    $p.marketplaces.'claude-plugins-official' | Should -Be 'anthropics/claude-plugins-official'
  }
  It 'Codex 프로필 모델 매핑이 설계 D6 과 같다' {
    $expect = @{ plan='gpt-6-astra'; 'deep-review'='gpt-6-astra'; work='gpt-6.1-sol'; 'plan-fallback'='gpt-6.1-sol'; review='gpt-6.1-sol'; research='gpt-6-luna'; build='gpt-6-luna' }
    foreach ($k in $expect.Keys) {
      (Get-Content -LiteralPath "$Repo\codex\$k.config.toml" -Encoding UTF8 | Where-Object { $_ -match '^model\s*=' }) |
        Should -Match ([regex]::Escape($expect[$k]))
    }
  }
}
