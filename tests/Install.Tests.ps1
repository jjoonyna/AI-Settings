# Pester 5 entry point for the Node installer integration suite.
BeforeAll { $Repo = Split-Path $PSScriptRoot -Parent }
Describe 'Independent installer, ownership and usage limits' {
  It 'preserves local configuration across install, mode switch and uninstall' {
    & node --test (Join-Path $Repo 'tests/runtime.test.mjs')
    $LASTEXITCODE | Should -Be 0
  }
}
