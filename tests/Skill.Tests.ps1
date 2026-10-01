BeforeAll { $Repo = Split-Path $PSScriptRoot -Parent; $S = "$Repo\claude\skills\agent-init" }
Describe 'agent-init 스킬' {
  It 'SKILL.md 가 frontmatter(name, description)를 갖는다' {
    $t = Get-Content "$S\SKILL.md" -Raw -Encoding UTF8
    $t | Should -Match '(?m)^---\s*$'
    $t | Should -Match '(?m)^name:\s*agent-init\s*$'
    $t | Should -Match '(?m)^description:\s*.+'
  }
  It '참고 파일 2개가 있다' {
    Test-Path "$S\reference\gen-impact.rbm.mjs" | Should -BeTrue
    Test-Path "$S\reference\CLAUDE.project.template.md" | Should -BeTrue
  }
  It '템플릿 CLAUDE.md 가 rbm 과 같은 절 골격을 갖는다' {
    $t = Get-Content "$S\reference\CLAUDE.project.template.md" -Raw -Encoding UTF8
    foreach ($h in 'Language Rules','Documentation Structure','Code Modification Rules','Project Overview','Development Commands','Architecture','Repository Layout','Testing') {
      $t | Should -Match ([regex]::Escape("## $h"))
    }
  }
  It 'SKILL.md 가 main 브랜치 쓰기 차단과 git 추적 결정을 명시한다' {
    $t = Get-Content "$S\SKILL.md" -Raw -Encoding UTF8
    $t | Should -Match 'main'
    $t | Should -Match 'git 추적'
  }
}
