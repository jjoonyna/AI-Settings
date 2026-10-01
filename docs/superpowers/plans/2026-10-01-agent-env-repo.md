# AI-Settings 저장소 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `~/.claude`, `~/.codex`, nvim 설정을 이 저장소로 옮기고, `install.ps1` 한 번으로 다른 Windows PC 에서 같은 에이전트 작업 환경이 재현되게 한다.

**Architecture:** 저장소가 정본이고 사용자 홈의 설정 위치는 심볼릭 링크(폴백: Junction/HardLink)로 저장소를 가리킨다. 머신 종속값은 `.tmpl` 파일에 `{{VAR}}` 로 두고 `install.ps1` 이 치환해 **생성 파일**로 쓴다(링크 아님). 프로젝트 고유 파일은 전역 스킬 `/agent-init` 이 프로젝트마다 만든다.

**Tech Stack:** PowerShell 5.1(`install.ps1`, Pester 5 테스트), Lua(nvim 설정), Node 22(`agent-done.js`, 영향 지도 생성기), Claude Code 2.1.x, Codex CLI 0.159.x, Neovim 0.12.

**Spec:** `docs/superpowers/specs/2026-10-01-agent-env-repo-design.md`

**커밋 정책(전역 CLAUDE.md §1):** 이 계획의 어떤 Task 도 커밋·머지를 수행하거나 언급하지 않는다. 각 Task 의 마지막 단계는 "변경 파일 목록 보고"다. 커밋은 사용자가 직접 지시할 때만 한다.

**브랜치:** `feat/agent-env-bootstrap` (이미 생성됨). 첫 쓰기 전 `git branch --show-current` 로 `main` 이 아님을 확인한다.

## Global Constraints

- Windows 전용. 스크립트는 **Windows PowerShell 5.1** 문법(`&&`·`??`·`?.` 금지, `-Encoding utf8` 명시).
- 비밀 파일은 저장소에 절대 넣지 않는다: `.credentials.json`, `auth.json`, `daemon/`, `*.key`, `history.jsonl`, `sessions/`, `projects/`, `file-history/`, `jobs/`, `cache/`, `plugins/cache/`, `plugins/installed_plugins.json`, `plugins/known_marketplaces.json`.
- 지침 정본은 `claude/CLAUDE.md` 하나. `~/.codex/AGENTS.md` 는 그것을 가리키는 링크.
- 머신 종속값(사용자 홈, 프로젝트 루트, JDK, python, node 경로)은 코드·설정에 하드코딩하지 않는다. `.tmpl` 또는 `nvim/lua/config/local.lua`(gitignore) 로 분리한다.
- `install.ps1` 은 멱등이다. 두 번 실행해도 결과가 같고 오류가 없다.
- `install.ps1` 은 기존 파일을 덮어쓰지 않는다. `~/.agent-env-backup/<yyyyMMdd-HHmmss>/` 로 이동한 뒤 링크를 만든다.
- 모든 사용자 노출 문자열(스크립트 출력, 주석, 문서)은 한국어.
- Codex 모델 매핑은 설계 D6 그대로: plan·deep-review `gpt-6-astra`/low, work·plan-fallback·review `gpt-6.1-sol`/medium, research·build `gpt-6-luna`/medium.

## Review Focus

1. **개발자 모드가 꺼진 PC** — `New-Item -ItemType SymbolicLink` 가 권한 오류로 실패한다. 폴더는 Junction, 파일은 HardLink 로 폴백하고 그 사실을 출력해야 한다(Task 4 테스트 `폴백` 케이스).
2. **`~/.claude` 에 이미 실제 파일이 있는 PC**(이 PC 가 그렇다) — 덮어쓰면 현재 설정이 사라진다. 백업 폴더로 이동한 뒤에만 링크해야 한다(Task 4 테스트 `백업` 케이스).
3. **두 번째 실행** — 이미 링크인 대상을 다시 백업하면 저장소 파일이 백업 폴더로 "이동"돼 저장소가 깨진다. 링크(ReparsePoint)면 건너뛰어야 한다(Task 4 테스트 `멱등` 케이스).
4. **경로에 공백·한글** — 저장소가 `OneDrive\바탕 화면\AI-Settings` 안에 있다. 모든 경로 인자를 따옴표로 감싸고 `-LiteralPath` 를 써야 한다(Task 4 테스트가 실제 저장소 경로로 돈다).
5. **`local.lua` 가 없는 nvim** — 설치 전이나 템플릿 치환 실패 시 `require("config.local")` 이 터지면 nvim 전체가 안 뜬다. `pcall` 로 감싸고 빈 테이블 기본값으로 동작해야 한다(Task 3 테스트 `local.lua 없음` 케이스).

## 영향 범위 (설계 §8 복사)

| 대상 | 변경 | Task |
|---|---|---|
| `~/.claude` | `CLAUDE.md`·`agents`·`hooks`·`statusline-command.ps1`·`skills/agent-init` 가 링크로 바뀜. `settings.json` 은 생성 파일 | 1, 2, 4, 5 |
| `~/.codex` | `AGENTS.md`·프로필 7개·`CODEX-사용안내.md` 가 링크로. `config.toml` 은 생성 파일 | 1, 2, 4 |
| `AppData/Local/nvim` | 폴더 전체가 링크. `plugins/lsp.lua`·`config/workspace.lua`·`agent/worktree.lua`·`tests/agent-hub/*.lua` 에서 절대경로를 `local.lua` 로 분리 | 3, 4 |
| `C:\ExRBM\rbm` | 변경 없음 | — |

## 변경 요청 로그

| 날짜 | 요청 | 상태 |
|---|---|---|
| 2026-10-01 | 개발자 모드 꺼진 PC: hardlink 폴백 제거, symlink → 관리자 승격 재실행(UAC) → 복사 폴백 + 매니페스트. 사용자 결정 "1 과 3 을 같이" | 승인·전달 (문서 끝 Task 4 수정 절) |
| 2026-10-01 | 핸드오프 브리핑 유실 수정: 프롬프트 감지(최대 30초) + 전송 후 1초 뒤 Enter. 사용자 선택 "프롬프트 감지 + 시간차" | 승인·전달 (Task 7) |
| 2026-10-01 | README 에 저장소 소개·사용법·AI 상호작용 설명 추가 | 승인·전달 (Task 6 README 보강 절) |
| 2026-10-01 | 설치 후 보정: settings.json 템플릿에 extraKnownMarketplaces + json 얕은 병합 보존 / uninstall 은 백업 전부 순차 복원 / -Python·-Jdk21 인자와 감지 순서 / Expand-Template 인코딩 수정 | 승인·전달 (계획 세션 결정, 사용자 보고) |
| 2026-10-01 | Task 7 보강: Enter 제출 확인 + 1초 간격 최대 5회 재시도(/
 교대). 실제 핸드오프 id=3 에서 Enter 2회 무시 관찰 | 승인·전달 (계획 세션 결정, 사용자 보고) |
| 2026-10-01 | 작업 세션 판단 3건(Task 5 선행, Do-Template 동일 시 건너뜀, rtp^=) | 승인·전달 |
| 2026-10-01 | (작업 세션 발견) `-Home` 파라미터가 `$HOME` 자동 변수와 충돌 → `-HomeDir` 로 변경, Task 2 테스트 지역 변수 `$home` → `$claudeHomeT` | 승인·전달 |

## 파일 구조

```
AI-Settings/
  install.ps1                     Task 4  진입점: 인자 파싱 → lib 호출 → 요약 출력
  uninstall.ps1                   Task 4  링크 제거 + 최신 백업 복원
  scripts/
    lib.ps1                       Task 2,4  함수 모음: Expand-Template, New-Link, Backup-Item, Test-IsLink
  tests/
    Lib.Tests.ps1                 Task 2  Expand-Template 단위 테스트
    Install.Tests.ps1             Task 4  임시 HOME 으로 install/uninstall 통합 테스트
    nvim-local.lua                Task 3  nvim 헤드리스에서 local.lua 분리 검증
  claude/
    CLAUDE.md                     Task 1  전역 지침 정본 (현재 ~/.claude/CLAUDE.md 이동)
    settings.json.tmpl            Task 2
    agents/*.md                   Task 1
    hooks/agent-done.js           Task 1
    statusline-command.ps1        Task 1
    plugins.json                  Task 1  마켓플레이스 + 플러그인 목록
    skills/agent-init/SKILL.md    Task 5
    skills/agent-init/reference/gen-impact.rbm.mjs      Task 5
    skills/agent-init/reference/CLAUDE.project.template.md  Task 5
  codex/
    config.toml.tmpl              Task 2
    {plan,plan-fallback,work,research,build,review,deep-review}.config.toml   Task 1
    CODEX-사용안내.md             Task 1
  nvim/                           Task 3  (AppData/Local/nvim 전체, 제외: backups/, *.bak, .agent-shared.md, docs/)
    lua/config/local.lua.tmpl     Task 3
  docs/superpowers/{specs,plans}/
  README.md                       Task 6
  .gitignore                      Task 1
```

---

### Task 0: Pester 5 준비

**Files:** 없음(환경)

- [ ] **Step 1: Pester 버전 확인**

Run (PowerShell):
```powershell
(Get-Module -ListAvailable Pester | Sort-Object Version -Descending | Select-Object -First 1).Version
```
Expected: `5.x`. `3.4.0` 만 나오면 Step 2.

- [ ] **Step 2: Pester 5 설치(필요 시)**

```powershell
Install-Module Pester -Force -SkipPublisherCheck -Scope CurrentUser -MinimumVersion 5.0
Import-Module Pester -MinimumVersion 5.0; (Get-Module Pester).Version
```
Expected: `5.x`. 이후 모든 테스트 실행은 `Import-Module Pester -MinimumVersion 5.0; Invoke-Pester -Path <file> -Output Detailed`.

---

### Task 1: 저장소 골격 + 전역 파일 이관 + `.gitignore`

**Files:**
- Create: `.gitignore`, `claude/plugins.json`
- Create(복사): `claude/CLAUDE.md`, `claude/agents/*.md`(5개), `claude/hooks/agent-done.js`, `claude/statusline-command.ps1`
- Create(복사): `codex/*.config.toml`(7개), `codex/CODEX-사용안내.md`
- Test: `tests/Secrets.Tests.ps1`

**Interfaces:**
- Produces: `claude/plugins.json` 형식 `{ "marketplaces": { "<이름>": "<github owner/repo>" }, "plugins": ["<name>@<marketplace>", ...] }` — Task 4 의 `Install-Plugins` 가 읽는다.

- [ ] **Step 1: 실패하는 테스트 — 비밀 파일이 저장소에 없고 필수 파일은 있다**

`tests/Secrets.Tests.ps1`:
```powershell
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
```

- [ ] **Step 2: 실행해 실패 확인**

```powershell
Import-Module Pester -MinimumVersion 5.0; Invoke-Pester -Path .\tests\Secrets.Tests.ps1 -Output Detailed
```
Expected: `claude\CLAUDE.md` 없음 등으로 FAIL.

- [ ] **Step 3: 파일 복사(이동 아님 — 설치 전까지 홈은 그대로 둔다)**

```powershell
New-Item -ItemType Directory -Force claude\agents, claude\hooks, codex, tests | Out-Null
Copy-Item "$env:USERPROFILE\.claude\CLAUDE.md" claude\CLAUDE.md
Copy-Item "$env:USERPROFILE\.claude\agents\*.md" claude\agents\
Copy-Item "$env:USERPROFILE\.claude\hooks\agent-done.js" claude\hooks\
Copy-Item "$env:USERPROFILE\.claude\statusline-command.ps1" claude\
Copy-Item "$env:USERPROFILE\.codex\*.config.toml" codex\
Copy-Item "$env:USERPROFILE\.codex\CODEX-사용안내.md" codex\
```

- [ ] **Step 4: `claude/plugins.json` 작성**

```json
{
  "marketplaces": {
    "claude-plugins-official": "anthropics/claude-plugins-official"
  },
  "plugins": [
    "superpowers@claude-plugins-official",
    "frontend-design@claude-plugins-official",
    "typescript-lsp@claude-plugins-official"
  ]
}
```

- [ ] **Step 5: `.gitignore` 작성**

```gitignore
# 머신별 생성 파일 (install.ps1 이 .tmpl 에서 만든다)
nvim/lua/config/local.lua

# 비밀·런타임 (실수로 복사되더라도 추적 금지)
*.credentials.json
auth.json
*.key
history.jsonl
installed_plugins.json
known_marketplaces.json

# 로컬 작업 상태
.agent-shared.md
worktrees/

# nvim 런타임 (nvim/.gitignore 의 LazyVim 기본 항목과 동일)
nvim/.tests
nvim/debug
nvim/.repro
nvim/data
nvim/*.log
nvim/backups/
nvim/**/*.bak*
```

- [ ] **Step 6: 테스트 통과 확인**

같은 명령. Expected: 5 PASS.

- [ ] **Step 7: 변경 파일 목록 보고** (`git status --short`)

---

### Task 2: 템플릿 파일과 `Expand-Template`

**Files:**
- Create: `scripts/lib.ps1`(함수 `Expand-Template` 부분), `claude/settings.json.tmpl`, `codex/config.toml.tmpl`
- Test: `tests/Lib.Tests.ps1`

**Interfaces:**
- Produces: `Expand-Template -TemplatePath <string> -Vars <hashtable> -OutPath <string>`. `{{KEY}}` 를 `Vars[KEY]` 로 치환. 치환되지 않은 `{{...}}` 가 남으면 `throw "치환되지 않은 변수: {{X}}"`. 출력은 UTF-8(BOM 없음).
- Produces: 변수 이름 규약 — `CLAUDE_HOME`(예 `C:\Users\x\.claude`), `CLAUDE_HOME_JSON`(백슬래시 두 번), `CLAUDE_HOME_FWD`(슬래시), `TRUSTED_PROJECTS_TOML`(여러 `[projects.'...']` 블록 문자열). Task 4 가 이 이름으로 값을 만든다.

- [ ] **Step 1: 실패하는 테스트**

`tests/Lib.Tests.ps1`:
```powershell
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
    $home = 'C:\Users\tester\.claude'
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
}
```

- [ ] **Step 2: 실행해 실패 확인** — `scripts\lib.ps1` 없음으로 FAIL.

- [ ] **Step 3: `scripts/lib.ps1` 의 `Expand-Template` 구현**

```powershell
# scripts/lib.ps1 — install.ps1 / uninstall.ps1 가 dot-source 하는 함수 모음 (Windows PowerShell 5.1)
Set-StrictMode -Version 2.0

function Expand-Template {
  param(
    [Parameter(Mandatory)][string]$TemplatePath,
    [Parameter(Mandatory)][hashtable]$Vars,
    [Parameter(Mandatory)][string]$OutPath
  )
  $text = [IO.File]::ReadAllText($TemplatePath, [Text.Encoding]::UTF8)
  foreach ($k in $Vars.Keys) {
    $text = $text.Replace('{{' + $k + '}}', [string]$Vars[$k])
  }
  $left = [regex]::Matches($text, '\{\{[A-Z0-9_]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
  if ($left) { throw ("치환되지 않은 변수: " + ($left -join ', ') + " (" + $TemplatePath + ")") }
  $dir = Split-Path -Parent $OutPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $utf8NoBom = New-Object Text.UTF8Encoding($false)
  if (-not $text.EndsWith("`n")) { $text += "`r`n" }
  [IO.File]::WriteAllText($OutPath, $text, $utf8NoBom)
}
```

- [ ] **Step 4: `claude/settings.json.tmpl` 작성** (현재 `settings.json` 에서 경로 두 곳만 변수화)

```json
{
  "permissions": {
    "defaultMode": "auto"
  },
  "model": "opus",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"{{CLAUDE_HOME_JSON}}\\hooks\\agent-done.js\"",
            "timeout": 15
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{{CLAUDE_HOME_JSON}}\\statusline-command.ps1\""
  },
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": true
  },
  "language": "Korea",
  "effortLevel": "medium",
  "autoUpdatesChannel": "latest",
  "tui": "fullscreen",
  "skipDangerousModePermissionPrompt": true
}
```

- [ ] **Step 5: `codex/config.toml.tmpl` 작성**

```toml
# 작업 완료 마커([AGENT-DONE]) 감지 시 세션 자동 종료 — ~/.claude/hooks/agent-done.js 참조
# 이 파일은 install.ps1 이 config.toml.tmpl 에서 생성한다. 직접 고치지 말고 템플릿을 고친다.
notify = ["node", "{{CLAUDE_HOME_FWD}}/hooks/agent-done.js", "--codex"]

{{TRUSTED_PROJECTS_TOML}}

[tui.model_availability_nux]
gpt-6-astra = 4

[windows]
sandbox = "unelevated"
```

- [ ] **Step 6: 테스트 통과 확인** — 4 PASS.

- [ ] **Step 7: 변경 파일 목록 보고**

---

### Task 3: nvim 이관 + 머신 종속값 `local.lua` 분리

**Files:**
- Create(복사): `nvim/**` (제외: `backups/`, `*.bak*`, `.agent-shared.md`, `docs/`)
- Create: `nvim/lua/config/local.lua.tmpl`
- Modify: `nvim/lua/config/workspace.lua:6-25`, `nvim/lua/config/agent/worktree.lua:63-75`, `nvim/lua/plugins/lsp.lua:27`, `nvim/tests/agent-hub/integration.lua:24,40`, `probe-server.lua:3`, `ui-integration.lua:27`
- Test: `tests/nvim-local.lua`

**Interfaces:**
- Produces: `require("config.local")` 가 반환하는 테이블 형식
  ```lua
  { jdk21 = "C:/Program Files/Java/jdk-21",         -- 없으면 nil
    python = "C:/.../python.exe",                   -- 없으면 nil
    projects = {                                    -- 프로파일 이름 → 루트 (소문자·슬래시 정규화는 코드가 함)
      rbm  = { root = "C:/ExRBM/rbm",  kind = "java" },
      docs = { root = "C:/DocsBackup", kind = "docs" },
    } }
  ```
- Produces: `require("config.local_loader").get()` — `pcall(require, "config.local")` 를 감싸 실패 시 `{ projects = {} }` 반환. 모든 소비자는 이것만 쓴다.
- 템플릿 변수(Task 4 가 채움): `JDK21`, `PYTHON`, `RBM_ROOT`, `DOCS_ROOT`. 빈 값이면 `nil` 이 되도록 템플릿에서 `nil_or("{{X}}")` 로 감싼다.

- [ ] **Step 1: 실패하는 테스트**

`tests/nvim-local.lua` (nvim 헤드리스로 실행):
```lua
-- 실행: nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
-- 저장소 루트에서 실행한다. 실패 시 exit 1.
local function fail(msg) io.stderr:write("FAIL: " .. msg .. "\n"); os.exit(1) end
local function ok(msg) io.stdout:write("ok: " .. msg .. "\n") end

-- 1) local.lua 없음 → 빈 기본값
package.loaded["config.local"] = nil
package.preload["config.local"] = function() error("없음") end
local L = require("config.local_loader").get()
if type(L.projects) ~= "table" then fail("local.lua 없을 때 projects 기본값이 없다") end
ok("local.lua 없음 → 기본값")

-- 2) local.lua 있음 → 프로파일 판정
package.preload["config.local"] = function()
  return { projects = { rbm = { root = "C:/ExRBM/rbm", kind = "java" } } }
end
package.loaded["config.local_loader"] = nil
local ws = require("config.workspace")
if ws.detect_profile("C:\\ExRBM\\rbm\\backend") ~= "rbm" then fail("rbm 하위 경로 판정 실패") end
if ws.detect_profile("C:\\ExRBM\\rbm-hotfix-2.4.5") ~= "rbm" then fail("hotfix worktree 판정 실패") end
if ws.detect_profile("D:\\other") ~= nil then fail("무관 경로가 프로파일에 잡힘") end
ok("workspace.detect_profile")

-- 3) worktree.suggest 가 저장소 이름에서 hotfix 접두를 만든다
local wt = require("config.agent.worktree")
local got = wt.suggest("hotfix/v9.9.9", "C:/ExRBM/rbm")
if got ~= "C:/ExRBM/rbm-hotfix-9.9.9" then fail("hotfix 경로: " .. tostring(got)) end
got = wt.suggest("feat/x", "C:/ExRBM/rbm")
if got ~= "C:/ExRBM/rbm/worktrees/x" then fail("임시 worktree 경로: " .. tostring(got)) end
ok("worktree.suggest")

-- 4) 하드코딩 잔존 검사
local function grep(path, pat)
  local f = assert(io.open(path, "r")); local s = f:read("a"); f:close()
  return s:find(pat, 1, true) ~= nil
end
for _, p in ipairs({ "nvim/lua/config/workspace.lua", "nvim/lua/config/agent/worktree.lua", "nvim/lua/plugins/lsp.lua",
                     "nvim/tests/agent-hub/integration.lua", "nvim/tests/agent-hub/probe-server.lua", "nvim/tests/agent-hub/ui-integration.lua" }) do
  if grep(p, "C:/Users/") or grep(p, "C:/Program Files") or grep(p, "c:/exrbm") or grep(p, "C:/ExRBM") then
    fail("절대경로 잔존: " .. p)
  end
end
ok("하드코딩 없음")
os.exit(0)
```

- [ ] **Step 2: 실행해 실패 확인**

```powershell
nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
```
Expected: `config.local_loader` 모듈 없음으로 FAIL.

- [ ] **Step 3: nvim 폴더 복사**

```powershell
robocopy "$env:LOCALAPPDATA\nvim" .\nvim /E /XD backups docs .tests debug .repro data /XF *.bak* .agent-shared.md *.log /NFL /NDL /NJH /NJS
```
Expected: exit code 1(복사 성공). `nvim\lua\config\agent\terminal.lua` 가 존재.

- [ ] **Step 4: `nvim/lua/config/local_loader.lua` 작성**

```lua
-- 머신 종속 설정(config/local.lua — gitignore, install.ps1 이 local.lua.tmpl 에서 생성)을 안전하게 읽는다.
-- 파일이 없거나 깨져도 nvim 은 떠야 하므로 pcall 로 감싸고 빈 기본값을 돌려준다.
local M = {}
local cache

function M.get()
  if cache then return cache end
  local ok, L = pcall(require, "config.local")
  if not ok or type(L) ~= "table" then L = {} end
  L.projects = L.projects or {}
  cache = L
  return L
end

--- 테스트용: 캐시를 비운다.
function M.reset() cache = nil; package.loaded["config.local"] = nil end

return M
```

- [ ] **Step 5: `nvim/lua/config/local.lua.tmpl` 작성**

```lua
-- 머신 종속 설정. install.ps1 이 local.lua.tmpl 에서 생성한다 — 직접 고치면 다음 설치에 덮어쓰인다.
-- 빈 문자열은 nil 로 취급한다.
local function nil_or(s) if s == nil or s == "" then return nil end return s end

return {
  jdk21  = nil_or("{{JDK21}}"),
  python = nil_or("{{PYTHON}}"),
  projects = {
    rbm  = { root = nil_or("{{RBM_ROOT}}"),  kind = "java" },
    docs = { root = nil_or("{{DOCS_ROOT}}"), kind = "docs" },
  },
}
```

- [ ] **Step 6: `workspace.lua` 수정** — 6행 `JDK21` 상수와 10~25행 `detect_profile` 을 다음으로 교체. `detect_profile` 을 `M.detect_profile(cwd)` 로 공개한다.

```lua
local local_cfg = require("config.local_loader").get()

local function norm(p) return (p:gsub("\\", "/"):lower()) end

--- 경로가 어느 프로파일에 속하는지 판정한다. root 와 "root-*"(hotfix worktree) 를 모두 그 프로파일로 본다.
--- @param cwd string|nil  nil 이면 vim.fn.getcwd()
--- @return string|nil
function M.detect_profile(cwd)
  local c = norm(cwd or vim.fn.getcwd())
  for name, p in pairs(local_cfg.projects) do
    if p.root then
      local r = norm(p.root)
      if c == r or c:sub(1, #r + 1) == r .. "/" or c:sub(1, #r + 1) == r .. "-" then
        return name
      end
    end
  end
  return nil
end
```
`apply_rbm` 안의 `JDK21` 참조는 `local JDK21 = local_cfg.jdk21` 로 바꾸고, `if not JDK21 or vim.fn.isdirectory(JDK21) == 0 then` 으로 nil 을 처리한다. `M.setup()` 의 `detect_profile()` 호출은 `M.detect_profile()` 로.

- [ ] **Step 7: `worktree.lua` `M.suggest` 수정** — 저장소 폴더 이름으로 hotfix 접두를 만든다. 테스트 가능하게 `main_path` 를 두 번째 인자로 받는다.

```lua
--- 새 worktree 폴더 경로를 제안한다.
--- hotfix/v<버전> → <본체 부모>/<본체 이름>-hotfix-<버전>   (예: C:/ExRBM/rbm-hotfix-2.4.5)
--- 그 밖           → <본체>/worktrees/<브랜치 마지막 토큰>   (머지 후 자동 삭제 대상 — 전역 CLAUDE.md §10)
--- @param branch string
--- @param main string|nil  테스트용. nil 이면 M.main_path()
--- @return string
function M.suggest(branch, main)
  main = (main or M.main_path()):gsub("\\", "/"):gsub("/$", "")
  local parent = vim.fn.fnamemodify(main, ":h")
  local name = vim.fn.fnamemodify(main, ":t")
  local ver = branch:match("^hotfix/v(.+)$")
  if ver then
    return parent .. "/" .. name .. "-hotfix-" .. ver
  end
  return main .. "/worktrees/" .. (branch:gsub("^[^/]+/", ""))
end
```

- [ ] **Step 8: `plugins/lsp.lua:27` 수정**

```lua
              pythonPath = require("config.local_loader").get().python,
```
(nil 이면 pyright 가 PATH 의 python 을 쓴다.)

- [ ] **Step 9: 테스트 4개 파일의 node 경로 수정** — `'C:/Program Files/nodejs/node.exe'` 를 `vim.fn.exepath('node')` 로 (4곳).

- [ ] **Step 10: 테스트 통과 확인**

```powershell
nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
```
Expected: `ok:` 4줄, exit 0.

- [ ] **Step 11: 기존 agent-hub 테스트가 여전히 도는지 확인**

```powershell
Get-Content nvim\README.md | Select-String -Pattern 'tests/agent-hub' -Context 0,3
```
README 가 안내하는 실행 명령으로 `nvim/tests/agent-hub/integration.lua` 를 돌린다. Expected: 기존과 같은 통과 출력. 실패하면 **출력 원문을 보고하고 멈춘다**(계획 이탈 금지).

- [ ] **Step 12: 변경 파일 목록 보고**

---

### Task 4: `install.ps1` / `uninstall.ps1`

**Files:**
- Modify: `scripts/lib.ps1` (함수 추가: `Test-IsLink`, `Backup-Item`, `New-Link`, `Get-TrustedProjectsToml`, `Install-Plugins`)
- Create: `install.ps1`, `uninstall.ps1`
- Test: `tests/Install.Tests.ps1`

**Interfaces:**
- Consumes: Task 2 `Expand-Template`, 변수 이름; Task 3 템플릿 변수 `JDK21`·`PYTHON`·`RBM_ROOT`·`DOCS_ROOT`; Task 1 `claude/plugins.json`.
- Produces:
  - `install.ps1 [-HomeDir <경로>] [-NvimDir <경로>] [-TrustedProjects <string[]>] [-RbmRoot <경로>] [-DocsRoot <경로>] [-SkipPlugins] [-DryRun]` — `-HomeDir` 기본 `$env:USERPROFILE`(PowerShell 의 읽기 전용 `$HOME` 과 충돌하므로 `-Home` 은 쓸 수 없다), `-NvimDir` 기본 `$env:LOCALAPPDATA\nvim`. 테스트는 임시 폴더를 넘긴다.
  - `uninstall.ps1 [-HomeDir] [-NvimDir]` — 링크 제거 후 `<Home>\.agent-env-backup` 의 최신 폴더에서 복원.
  - `New-Link -Link <경로> -Target <경로>` → 반환 문자열 `'symlink' | 'junction' | 'hardlink' | 'skip(이미 링크)'`.
  - `Backup-Item -Path <경로> -BackupRoot <경로>` → 이동했으면 새 경로, 없거나 링크면 `$null`.

- [ ] **Step 1: 실패하는 테스트**

`tests/Install.Tests.ps1`:
```powershell
BeforeAll {
  $Repo = Split-Path $PSScriptRoot -Parent
  . "$Repo\scripts\lib.ps1"
  $Tmp = Join-Path $env:TEMP ("ai-settings-install-" + [guid]::NewGuid())
  $Home2 = Join-Path $Tmp 'home'; $Nvim2 = Join-Path $Tmp 'nvim'
  New-Item -ItemType Directory -Path $Home2 | Out-Null
  # 기존 사용자 파일을 흉내낸다(백업 대상)
  New-Item -ItemType Directory -Path "$Home2\.claude\hooks" -Force | Out-Null
  Set-Content "$Home2\.claude\CLAUDE.md" '옛 지침' -Encoding UTF8
  Set-Content "$Home2\.claude\.credentials.json" '{"secret":1}' -Encoding UTF8
  New-Item -ItemType Directory -Path $Nvim2 | Out-Null
  Set-Content "$Nvim2\init.lua" '-- 옛 nvim' -Encoding UTF8
  $run = { & "$Repo\install.ps1" -HomeDir $Home2 -NvimDir $Nvim2 -TrustedProjects @('C:\proj a','D:\x') -RbmRoot 'C:\ExRBM\rbm' -SkipPlugins }
}
AfterAll {
  # 링크를 먼저 끊어야 저장소 파일이 지워지지 않는다
  Get-ChildItem -LiteralPath $Tmp -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Delete() }
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'install.ps1' {
  It '첫 실행: 기존 파일을 백업하고 링크·생성 파일을 만든다' {
    & $run | Out-Null
    $bk = Get-ChildItem "$Home2\.agent-env-backup" | Select-Object -First 1
    Get-Content "$($bk.FullName)\.claude\CLAUDE.md" | Should -Be '옛 지침'
    Get-Content "$($bk.FullName)\nvim\init.lua" | Should -Be '-- 옛 nvim'
    (Get-Item "$Home2\.claude\CLAUDE.md").Attributes -band [IO.FileAttributes]::ReparsePoint | Should -Not -Be 0
    (Get-Item "$Home2\.codex\AGENTS.md").Attributes -band [IO.FileAttributes]::ReparsePoint | Should -Not -Be 0
    Get-Content "$Home2\.codex\AGENTS.md" -Raw | Should -Be (Get-Content "$Repo\claude\CLAUDE.md" -Raw)
    (Get-Item $Nvim2).Attributes -band [IO.FileAttributes]::ReparsePoint | Should -Not -Be 0
    Test-Path "$Nvim2\lua\config\agent\terminal.lua" | Should -BeTrue
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
  It '두 번째 실행: 오류 없이 끝나고 백업 폴더가 늘지 않는다' {
    $before = (Get-ChildItem "$Home2\.agent-env-backup").Count
    { & $run | Out-Null } | Should -Not -Throw
    (Get-ChildItem "$Home2\.agent-env-backup").Count | Should -Be $before
    Test-Path "$Repo\claude\CLAUDE.md" | Should -BeTrue   # 저장소 파일이 백업으로 이동되지 않았다
  }
  It '-DryRun 은 아무것도 바꾸지 않는다' {
    $h3 = Join-Path $Tmp 'home3'; New-Item -ItemType Directory $h3 | Out-Null
    & "$Repo\install.ps1" -HomeDir $h3 -NvimDir (Join-Path $Tmp 'nvim3') -SkipPlugins -DryRun | Out-Null
    Test-Path "$h3\.claude" | Should -BeFalse
  }
}

Describe 'uninstall.ps1' {
  It '링크를 지우고 최신 백업을 복원한다' {
    & "$Repo\uninstall.ps1" -HomeDir $Home2 -NvimDir $Nvim2 | Out-Null
    Get-Content "$Home2\.claude\CLAUDE.md" | Should -Be '옛 지침'
    (Get-Item "$Home2\.claude\CLAUDE.md").Attributes -band [IO.FileAttributes]::ReparsePoint | Should -Be 0
    Get-Content "$Nvim2\init.lua" | Should -Be '-- 옛 nvim'
    Test-Path "$Repo\claude\CLAUDE.md" | Should -BeTrue
  }
}
```

- [ ] **Step 2: 실행해 실패 확인** — `install.ps1` 없음.

- [ ] **Step 3: `scripts/lib.ps1` 에 함수 추가**

```powershell
function Test-IsLink {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# 기존 실제 파일/폴더를 BackupRoot 아래 같은 상대 구조로 이동한다. 없거나 이미 링크면 $null.
function Backup-Item {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$BackupRoot, [Parameter(Mandatory)][string]$RelName)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  if (Test-IsLink $Path) { return $null }
  $dest = Join-Path $BackupRoot $RelName
  $parent = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Move-Item -LiteralPath $Path -Destination $dest -Force
  return $dest
}

# 링크를 만든다. SymbolicLink → (폴더) Junction / (파일) HardLink 폴백. 이미 링크면 건너뛴다.
function New-Link {
  param([Parameter(Mandatory)][string]$Link, [Parameter(Mandatory)][string]$Target)
  if (Test-IsLink $Link) { return 'skip(이미 링크)' }
  if (Test-Path -LiteralPath $Link) { throw "링크 위치에 실제 파일이 남아 있습니다(백업 실패?): $Link" }
  $parent = Split-Path -Parent $Link
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $isDir = (Get-Item -LiteralPath $Target).PSIsContainer
  try {
    New-Item -ItemType SymbolicLink -Path $Link -Target $Target -ErrorAction Stop | Out-Null
    return 'symlink'
  } catch {
    if ($isDir) {
      New-Item -ItemType Junction -Path $Link -Target $Target -ErrorAction Stop | Out-Null
      return 'junction'
    } else {
      New-Item -ItemType HardLink -Path $Link -Target $Target -ErrorAction Stop | Out-Null
      return 'hardlink'
    }
  }
}

# Codex trust 블록 문자열. 경로는 Codex 가 쓰는 형태(소문자, 백슬래시)로 정규화한다.
function Get-TrustedProjectsToml {
  param([string[]]$Paths)
  $blocks = foreach ($p in $Paths) {
    if (-not $p) { continue }
    $n = $p.TrimEnd('\').ToLowerInvariant()
    "[projects.'$n']`r`ntrust_level = `"trusted`""
  }
  return ($blocks -join "`r`n`r`n")
}

function Install-Plugins {
  param([Parameter(Mandatory)][string]$PluginsJson, [switch]$DryRun)
  $p = Get-Content -LiteralPath $PluginsJson -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($m in $p.marketplaces.PSObject.Properties) {
    Write-Host ("  마켓플레이스 등록: {0} ← {1}" -f $m.Name, $m.Value)
    if (-not $DryRun) { & claude plugin marketplace add $m.Value 2>&1 | Out-Host }
  }
  foreach ($name in $p.plugins) {
    Write-Host ("  플러그인 설치: {0}" -f $name)
    if (-not $DryRun) { & claude plugin install $name 2>&1 | Out-Host }
  }
}
```
주의: `New-Link` 의 HardLink 폴백은 같은 볼륨에서만 된다. 다른 볼륨이면 `New-Item` 이 throw 하고 그대로 올라간다 — install.ps1 이 잡아 "개발자 모드를 켜거나 관리자 권한으로 다시 실행" 안내를 출력한다.

- [ ] **Step 4: `install.ps1` 작성**

```powershell
<#
.SYNOPSIS  AI-Settings 저장소를 이 PC 의 ~/.claude, ~/.codex, nvim 설정에 연결한다.
.EXAMPLE   .\install.ps1 -TrustedProjects @('C:\ExRBM\rbm') -RbmRoot 'C:\ExRBM\rbm'
#>
[CmdletBinding()]
param(
  [string]$HomeDir = $env:USERPROFILE,
  [string]$NvimDir = (Join-Path $env:LOCALAPPDATA 'nvim'),
  [string[]]$TrustedProjects = @(),
  [string]$RbmRoot = '',
  [string]$DocsRoot = '',
  [switch]$SkipPlugins,
  [switch]$DryRun
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
. "$Repo\scripts\lib.ps1"

$claudeHome = Join-Path $HomeDir '.claude'
$codexHome  = Join-Path $HomeDir '.codex'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $HomeDir ".agent-env-backup\$stamp"
$report = New-Object System.Collections.ArrayList

function Say($msg) { Write-Host $msg }
function Do-Link($rel, $link, $target) {
  if ($DryRun) { [void]$report.Add(@{ 대상 = $rel; 처리 = 'dry-run'; 비고 = $link }); return }
  $moved = Backup-Item -Path $link -BackupRoot $backupRoot -RelName $rel
  $how = New-Link -Link $link -Target $target
  $note = if ($moved) { "백업 → $moved" } else { '' }
  [void]$report.Add(@{ 대상 = $rel; 처리 = $how; 비고 = $note })
}
function Do-Template($rel, $tmpl, $out, $vars) {
  if ($DryRun) { [void]$report.Add(@{ 대상 = $rel; 처리 = 'dry-run'; 비고 = $out }); return }
  if ((Test-Path -LiteralPath $out) -and -not (Test-IsLink $out)) {
    [void](Backup-Item -Path $out -BackupRoot $backupRoot -RelName $rel)
  }
  Expand-Template -TemplatePath $tmpl -Vars $vars -OutPath $out
  [void]$report.Add(@{ 대상 = $rel; 처리 = '생성'; 비고 = $out })
}

# 0. 요구사항
Say '== 요구사항 확인'
$missing = @('git','node','nvim','claude','codex') | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
if ($missing) { Say ("  PATH 에 없음: " + ($missing -join ', ')); if (-not $DryRun) { throw '필수 도구가 없어 중단합니다.' } }
else { Say '  git / node / nvim / claude / codex 모두 있음' }
if ($DryRun) { Say '  (-DryRun: 아무것도 바꾸지 않습니다)' }

# 1. ~/.claude
Say '== ~/.claude'
Do-Link '.claude\CLAUDE.md'              (Join-Path $claudeHome 'CLAUDE.md')              "$Repo\claude\CLAUDE.md"
Do-Link '.claude\agents'                 (Join-Path $claudeHome 'agents')                 "$Repo\claude\agents"
Do-Link '.claude\hooks'                  (Join-Path $claudeHome 'hooks')                  "$Repo\claude\hooks"
Do-Link '.claude\statusline-command.ps1' (Join-Path $claudeHome 'statusline-command.ps1') "$Repo\claude\statusline-command.ps1"
Do-Link '.claude\skills\agent-init'      (Join-Path $claudeHome 'skills\agent-init')      "$Repo\claude\skills\agent-init"
Do-Template '.claude\settings.json' "$Repo\claude\settings.json.tmpl" (Join-Path $claudeHome 'settings.json') @{
  CLAUDE_HOME_JSON = $claudeHome.Replace('\', '\\')
}

# 2. ~/.codex
Say '== ~/.codex'
Do-Link '.codex\AGENTS.md' (Join-Path $codexHome 'AGENTS.md') "$Repo\claude\CLAUDE.md"
foreach ($f in Get-ChildItem -LiteralPath "$Repo\codex" -Filter '*.config.toml') {
  Do-Link ".codex\$($f.Name)" (Join-Path $codexHome $f.Name) $f.FullName
}
Do-Link '.codex\CODEX-사용안내.md' (Join-Path $codexHome 'CODEX-사용안내.md') "$Repo\codex\CODEX-사용안내.md"
$trust = @($TrustedProjects) + @($HomeDir)
Do-Template '.codex\config.toml' "$Repo\codex\config.toml.tmpl" (Join-Path $codexHome 'config.toml') @{
  CLAUDE_HOME_FWD       = $claudeHome.Replace('\', '/')
  TRUSTED_PROJECTS_TOML = Get-TrustedProjectsToml -Paths $trust
}

# 3. nvim (폴더 전체 링크 + local.lua 생성)
Say '== nvim'
$jdk = if ($env:JAVA_HOME -and (Test-Path -LiteralPath $env:JAVA_HOME)) { $env:JAVA_HOME } elseif (Test-Path 'C:\Program Files\Java\jdk-21') { 'C:\Program Files\Java\jdk-21' } else { '' }
$py  = (Get-Command python -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $py) { $py = '' }
Do-Template 'nvim\lua\config\local.lua' "$Repo\nvim\lua\config\local.lua.tmpl" "$Repo\nvim\lua\config\local.lua" @{
  JDK21 = $jdk.Replace('\', '/'); PYTHON = $py.Replace('\', '/')
  RBM_ROOT = $RbmRoot.Replace('\', '/'); DOCS_ROOT = $DocsRoot.Replace('\', '/')
}
Do-Link 'nvim' $NvimDir "$Repo\nvim"

# 4. 플러그인
if (-not $SkipPlugins) { Say '== Claude 플러그인'; Install-Plugins -PluginsJson "$Repo\claude\plugins.json" -DryRun:$DryRun }

# 5. 요약
Say ''
Say '== 결과'
$report | ForEach-Object { [pscustomobject]$_ } | Format-Table -AutoSize 대상, 처리, 비고 | Out-String | Write-Host
if (-not $DryRun -and (Test-Path -LiteralPath $backupRoot)) { Say "기존 파일 백업 위치: $backupRoot" }
Say ''
Say '사람이 할 일:'
Say '  1. claude login  /  codex login'
Say '  2. nvim 을 한 번 열어 lazy.nvim 플러그인 설치를 기다린다'
Say '  3. 개발자 모드가 꺼져 있어 junction/hardlink 로 폴백됐다면, 설정 > 개발자용 > 개발자 모드를 켜고 다시 실행하면 symlink 로 바뀐다'
```

- [ ] **Step 5: `uninstall.ps1` 작성**

```powershell
<# AI-Settings 링크를 제거하고 가장 최근 백업을 복원한다. #>
[CmdletBinding()]
param(
  [string]$HomeDir = $env:USERPROFILE,
  [string]$NvimDir = (Join-Path $env:LOCALAPPDATA 'nvim')
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\lib.ps1"
$claudeHome = Join-Path $HomeDir '.claude'; $codexHome = Join-Path $HomeDir '.codex'

$links = @(
  (Join-Path $claudeHome 'CLAUDE.md'), (Join-Path $claudeHome 'agents'), (Join-Path $claudeHome 'hooks'),
  (Join-Path $claudeHome 'statusline-command.ps1'), (Join-Path $claudeHome 'skills\agent-init'),
  (Join-Path $codexHome 'AGENTS.md'), (Join-Path $codexHome 'CODEX-사용안내.md'), $NvimDir
) + @(Get-ChildItem -LiteralPath $codexHome -Filter '*.config.toml' -ErrorAction SilentlyContinue | ForEach-Object FullName)

foreach ($l in $links) {
  if (Test-IsLink $l) {
    # 링크 자체만 지운다(대상 저장소 파일은 남는다). 폴더 링크는 Delete(), 파일 링크는 Remove-Item.
    $item = Get-Item -LiteralPath $l -Force
    if ($item.PSIsContainer) { $item.Delete() } else { Remove-Item -LiteralPath $l -Force }
    Write-Host "링크 제거: $l"
  }
}
foreach ($g in @((Join-Path $claudeHome 'settings.json'), (Join-Path $codexHome 'config.toml'))) {
  if ((Test-Path -LiteralPath $g) -and -not (Test-IsLink $g)) { Remove-Item -LiteralPath $g -Force; Write-Host "생성 파일 제거: $g" }
}

$bkRoot = Join-Path $HomeDir '.agent-env-backup'
$latest = Get-ChildItem -LiteralPath $bkRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($latest) {
  Get-ChildItem -LiteralPath $latest.FullName -Recurse -Force -File | ForEach-Object {
    $rel = $_.FullName.Substring($latest.FullName.Length + 1)
    $dest = if ($rel -like 'nvim\*') { Join-Path (Split-Path -Parent $NvimDir) $rel } else { Join-Path $HomeDir $rel }
    $parent = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  }
  Write-Host "복원: $($latest.FullName)"
} else { Write-Host '복원할 백업이 없습니다.' }
```
주의: `uninstall` 의 nvim 복원은 백업 폴더의 `nvim\` 하위를 `$NvimDir` 로 되돌린다. 백업 시 `RelName` 이 `'nvim'` 이었으므로 구조가 맞는다.

- [ ] **Step 6: 테스트 통과 확인**

```powershell
Import-Module Pester -MinimumVersion 5.0; Invoke-Pester -Path .\tests\Install.Tests.ps1 -Output Detailed
```
Expected: 6 PASS. 개발자 모드가 꺼져 있으면 `처리` 열이 `junction`/`hardlink` 로 나와도 테스트는 ReparsePoint 만 보므로 통과한다. HardLink 는 ReparsePoint 가 **아니다** — 파일 링크가 hardlink 로 폴백된 환경이면 첫 It 의 `CLAUDE.md` ReparsePoint 단언이 실패한다. 그 경우 테스트 단언을 `(Get-Content ... -Raw) -eq (Get-Content 저장소 -Raw)` 내용 비교로 바꾸고 그 사실을 보고한다.

- [ ] **Step 7: 전체 테스트 한 번에**

```powershell
Invoke-Pester -Path .\tests -Output Detailed
nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
```

- [ ] **Step 8: 변경 파일 목록 보고**

---

### Task 5: `/agent-init` 스킬

**Files:**
- Create: `claude/skills/agent-init/SKILL.md`, `claude/skills/agent-init/reference/gen-impact.rbm.mjs`(rbm 의 `docs/tools/gen-impact.mjs` 복사), `claude/skills/agent-init/reference/CLAUDE.project.template.md`
- Test: `tests/Skill.Tests.ps1`

**Interfaces:**
- Consumes: 전역 `CLAUDE.md` §0(브랜치 확인), §2(researcher 위임), 설계 §7.
- Produces: 프로젝트에 `CLAUDE.md`, `AGENTS.md`(사본), `docs/impact.md`, `docs/tools/gen-impact.mjs`, `.gitignore` 항목, `.claude/settings.local.json`.

- [ ] **Step 1: 실패하는 테스트**

`tests/Skill.Tests.ps1`:
```powershell
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
```

- [ ] **Step 2: 실행해 실패 확인.**

- [ ] **Step 3: 참고 파일 복사와 템플릿 작성**

```powershell
New-Item -ItemType Directory -Force claude\skills\agent-init\reference | Out-Null
Copy-Item C:\ExRBM\rbm\docs\tools\gen-impact.mjs claude\skills\agent-init\reference\gen-impact.rbm.mjs
```
`reference/CLAUDE.project.template.md` — rbm `CLAUDE.md` 의 절 제목을 골격으로, 본문은 `<!-- TODO: 확인 필요 — 조사 결과로 채운다: ... -->` 주석과 한 줄 설명으로 채운 템플릿. 절: `## Language Rules`, `## Documentation Structure`, `## Code Modification Rules`, `## Project Overview`, `## Development Commands`(`### Backend`/`### Frontend` 하위는 조사 결과에 따라 삭제 가능), `## Architecture`, `## Repository Layout`, `## Testing`. 각 절 아래에 "무엇을 적는 절인지" 1~2줄 안내를 둔다. Language Rules 절은 템플릿에 완성형으로 넣는다:

```markdown
## Language Rules

- 사용자가 읽는 모든 출력(대화·보고·문서·주석)은 한국어다. 코드 식별자·경로·명령·로그 원문은 그대로 둔다.
- 이 파일(`CLAUDE.md`)과 `AGENTS.md` 는 git 으로 추적한다. 두 파일은 같은 내용의 사본이며 한쪽을 고치면 다른 쪽도 같이 고친다.
```

- [ ] **Step 4: `SKILL.md` 작성**

```markdown
---
name: agent-init
description: 새 프로젝트에 AI 에이전트 작업 환경의 프로젝트 고유 파일(CLAUDE.md, AGENTS.md, docs/impact.md 와 생성기, .gitignore 항목, .claude/settings.local.json)을 만든다. 프로젝트 루트에서 "/agent-init" 또는 "이 프로젝트 에이전트 초기화해" 라고 하면 사용한다.
---

# agent-init — 프로젝트 고유 설정 초기화

전역 지침(`~/.claude/CLAUDE.md`)이 절차(계획/작업 세션, 핸드오프, `.agent-shared.md`)를 담당하고, 이 스킬은 **프로젝트마다 달라지는 파일**을 만든다. 영향 지도 생성기는 프로젝트 구조에 종속이므로 복사하지 않고 **조사 뒤 새로 작성**한다.

## 0. 쓰기 전 확인
- `git branch --show-current` 가 `main` 이면 **"브랜치를 바꿔야 합니다"** 라고 알리고 파일을 쓰지 않는다(전역 §0).
- 이미 `CLAUDE.md` 가 있으면 덮어쓰지 않고 멈춰 사용자에게 묻는다.

## 1. 조사 (`researcher` 서브에이전트, sonnet)
다음을 조사해 결론만 받는다: 언어·프레임워크, 빌드·테스트·실행 명령, 디렉터리 구조(백엔드/프론트/문서), DB 스키마 파일 위치, API 라우트 정의 위치, i18n 파일, 기존 `.gitignore`, 기존 문서 폴더.

## 2. `CLAUDE.md` 초안
`reference/CLAUDE.project.template.md` 를 골격으로 조사 결과를 채운다. 못 채운 칸은 `<!-- TODO: 확인 필요 -->` 로 남긴다. 완성 후 `AGENTS.md` 를 같은 내용으로 만든다. **둘 다 git 추적 대상이다**(2026-10-01 결정). 기존 `.gitignore` 에 `CLAUDE.md`/`AGENTS.md` 가 있으면 제거를 제안한다(제거는 사용자 승인 뒤).

## 3. 영향 지도
1. 조사 결과로 영향 지도의 축 후보를 정리한다 — 테이블·컬럼 / 엔드포인트 / 모듈 / 값 집합(enum·상수) / 성질(권한·표시 규칙 등).
2. **사용자에게 한 번 확인**받는다: 어느 축을 넣을지, 수동 절은 무엇인지.
3. `docs/tools/gen-impact.mjs` 를 **이 프로젝트 구조에 맞게 새로** 작성한다. `reference/gen-impact.rbm.mjs` 는 출력 형식·멱등 정렬·"설정 블록은 여기만 고친다" 구조의 참고 예시다. 그대로 복사하지 않는다.
4. 실행해 `docs/impact.md` 를 만든다. 첫 줄은 `기준: <git 짧은 해시> (<YYYY-MM-DD>) · 생성 절: ... · 수동 절: ...`.
5. 두 번 실행해 출력이 같은지 확인한다.

## 4. `.gitignore` 항목 추가
```
# 에이전트 세션 간 공유 메모 (로컬 작업 상태)
.agent-shared.md
# 임시 병렬 worktree (머지 후 자동 삭제 — 전역 CLAUDE.md §10)
worktrees/
```

## 5. `.claude/settings.local.json`
조사한 빌드·테스트·dev 서버 명령과 git 조회 명령을 `permissions.allow` 에 넣는다. 절대경로 `Read(//c/...)` 항목은 넣지 않는다(머신 종속).

## 6. 완료 보고
생성 파일 목록, `TODO` 칸 목록, 영향 지도 축과 수동 절, 사용자가 확인할 것. **커밋·머지는 언급하지 않는다**(전역 §1).
```

- [ ] **Step 5: 테스트 통과 확인.**

- [ ] **Step 6: 샘플 프로젝트에서 스킬 동작 확인**

```powershell
$s = Join-Path $env:TEMP 'agent-init-sample'; New-Item -ItemType Directory -Force $s | Out-Null
Set-Location $s; git init -q; git switch -c dev
npm init -y | Out-Null; New-Item -ItemType Directory -Force src | Out-Null
Set-Content src\index.js 'module.exports = { hello: () => "hi" };'
```
이 폴더에서 `claude` 를 열어 `/agent-init` 을 실행한다(스킬은 Task 4 설치 후 `~/.claude/skills/agent-init` 에 링크돼 있어야 보인다. 설치 전이면 `--add-dir` 대신 **Task 6 의 실제 설치 뒤**에 이 단계를 수행한다). Expected: `CLAUDE.md`, `AGENTS.md`, `docs/impact.md`, `docs/tools/gen-impact.mjs`, `.gitignore` 항목, `.claude/settings.local.json` 생성. 결과 파일 목록을 보고한다.

- [ ] **Step 7: 변경 파일 목록 보고**

---

### Task 6: 이 PC 실제 설치 + README

**Files:**
- Create: `README.md`
- 홈 디렉터리 변경(저장소 밖): `~/.claude`, `~/.codex`, `AppData/Local/nvim` 이 링크로 바뀜

**Interfaces:** Consumes: Task 1~5 전부.

- [ ] **Step 1: 설치 직전 상태 기록**

```powershell
git branch --show-current          # feat/agent-env-bootstrap 이어야 한다
Get-ChildItem $env:USERPROFILE\.claude | Select-Object Name, Attributes
Get-ChildItem $env:USERPROFILE\.codex -Filter *.toml | Select-Object Name
```

- [ ] **Step 2: Dry-run**

```powershell
.\install.ps1 -TrustedProjects @('C:\ExRBM\rbm','C:\Tomcat\webapps','C:\Tomcat\webapps\ExRBM') -RbmRoot 'C:\ExRBM\rbm' -DocsRoot 'C:\DocsBackup' -DryRun
```
Expected: 결과 표에 `dry-run` 만, 파일 변화 없음.

- [ ] **Step 3: 실제 설치** (**실행 전 사용자에게 한 번 알린다** — 홈 설정이 링크로 바뀌는 되돌릴 수 있는 변경이다. 백업 위치가 출력된다)

같은 명령에서 `-DryRun` 제거. 플러그인 설치 단계에서 `claude plugin install` 이 "이미 설치됨" 을 내도 정상.

- [ ] **Step 4: 기능 확인**

```powershell
Get-Item $env:USERPROFILE\.claude\CLAUDE.md | Select-Object LinkType, Target
Get-Item $env:LOCALAPPDATA\nvim | Select-Object LinkType, Target
Get-Content $env:USERPROFILE\.codex\config.toml | Select-String notify
claude --version
nvim --headless "+lua print(require('config.local_loader').get().projects.rbm.root)" +q
```
Expected: LinkType `SymbolicLink`(또는 폴백 종류), nvim 출력 `C:/ExRBM/rbm`. 이어서 **새 터미널**에서 `claude` 를 열어 서브에이전트 목록에 `researcher`·`implementer` 가 보이는지, `codex --profile work` 를 열어 모델 표시가 `gpt-6.1-sol` 인지 확인하고 즉시 종료한다. nvim 을 열어 `:AgentHubStatus` 가 동작하는지 확인한다. 결과 원문을 보고한다.

- [ ] **Step 5: Task 5 Step 6(샘플 프로젝트 `/agent-init`) 수행** — 설치가 끝났으므로 스킬이 보인다.

- [ ] **Step 6: `README.md` 작성**

```markdown
# AI-Settings

Claude Code · Codex · Neovim(LazyVim) 에이전트 작업 환경 설정. 어떤 Windows PC 에서든 clone 과 설치 한 번으로 같은 방식(계획/작업 세션 분리, 서브에이전트, 핸드오프, `:AgentMerge`)으로 일한다.

## 요구사항
Windows 10/11, PowerShell 5.1, git, Node 22+, Neovim 0.12+, Claude Code 2.1+, Codex CLI 0.159+.
개발자 모드(설정 › 개발자용)를 켜면 symlink 로 연결된다. 꺼져 있으면 junction/hardlink 로 폴백한다.

## 설치
```powershell
git clone https://github.com/jjoonyna/AI-Settings.git
cd AI-Settings
.\install.ps1 -TrustedProjects @('C:\경로\프로젝트') -RbmRoot 'C:\ExRBM\rbm'
claude login
codex login
```
`-DryRun` 으로 먼저 무엇이 바뀌는지 볼 수 있다. 기존 설정은 `~\.agent-env-backup\<시각>\` 로 이동되고 `.\uninstall.ps1` 이 되돌린다.

## 새 프로젝트에서
프로젝트 루트에서 Claude Code 를 열고 `/agent-init`. 코드베이스를 조사해 `CLAUDE.md`·`AGENTS.md`·`docs/impact.md`(+생성기)·`.gitignore` 항목·`.claude/settings.local.json` 을 만든다.

## 구조
| 폴더 | 내용 | 설치 후 위치 |
|---|---|---|
| `claude/` | 전역 지침 정본 `CLAUDE.md`, 서브에이전트, 훅, 상태줄, `agent-init` 스킬, `settings.json.tmpl` | `~\.claude\` (settings.json 은 생성 파일) |
| `codex/` | 프로필 7개, `config.toml.tmpl`, 사용안내 | `~\.codex\` (`AGENTS.md` 는 `claude/CLAUDE.md` 링크) |
| `nvim/` | LazyVim 설정 + 에이전트 허브(`lua/config/agent/`) | `%LOCALAPPDATA%\nvim` (폴더 링크). 머신값은 `lua/config/local.lua` 생성 |
| `docs/superpowers/` | 설계·계획 문서 | — |

## 모델 매핑
| 역할 | Claude | Codex |
|---|---|---|
| 계획·교차검수 | Fable 5.1 (low) | `gpt-6-astra` (low) |
| 작업·검수·계획 폴백 | Opus 5 | `gpt-6.1-sol` (medium) |
| 조사·구현 | Sonnet 5 | `gpt-6-luna` (medium) |

## 수정 방법
저장소 파일을 고치면 링크를 통해 바로 반영된다. `settings.json`·`config.toml`·`local.lua` 는 **템플릿**(`.tmpl`)을 고치고 `install.ps1` 을 다시 실행한다(멱등).

## 테스트
```powershell
Import-Module Pester -MinimumVersion 5.0; Invoke-Pester -Path .\tests -Output Detailed
nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
```

## 범위 밖
macOS/Linux(`agent-done.js`·상태줄이 PowerShell 종속), 인증 정보(절대 포함하지 않음), Claude 계정 동기화 스킬(`skills/synced`).
```

- [ ] **Step 7: 전체 테스트 재실행 + 무단 커밋 점검**

```powershell
Invoke-Pester -Path .\tests -Output Detailed
nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
git log --oneline -20; git log --merges --oneline -10; git status --short
```
Expected: 테스트 전부 PASS. `git log` 는 "커밋 없음"(사용자가 지시하지 않았으므로). `git status` 에 변경 파일만.

- [ ] **Step 8: 완료 보고(전역 §4 형식)** — 완료 Task 목록 / 변경 파일 / 영향 범위 표 칸별 처리 / 실패한 검증 원문 / 백업 위치. 커밋·머지 언급 없음. 작업 세션이면 마지막 줄 `[AGENT-DONE]`.

---

## 자체 검토 결과

- **스펙 커버리지**: 설계 §3 구조 → Task 1~5 파일 구조. §4 D1(정본 하나) → Task 1 테스트 + Task 4 AGENTS.md 링크. D2(템플릿) → Task 2. D3(링크+폴백) → Task 4 `New-Link`. D4(스킬) → Task 5. D5(플러그인 목록) → Task 1·4. D6(모델 매핑) → Task 1 테스트. D7(Windows) → Global Constraints. D8(개인 취향 포함) → Task 2 템플릿 + 테스트 `language`·`tui`. §5 치환 표 10행 → Task 2(2행 settings, 2행 config.toml), Task 3(lsp, workspace, worktree, tests), 문서 예시 2행은 유지. §6 install 7단계 → Task 4. §7 스킬 → Task 5. §10 검증 → Task 6.
- **플레이스홀더**: 없음. `CLAUDE.project.template.md` 의 `TODO` 는 산출물 자체의 의도된 표식이다.
- **이름 일관성**: `Expand-Template`, `New-Link`, `Backup-Item`, `Test-IsLink`, `Get-TrustedProjectsToml`, `Install-Plugins`, `config.local_loader.get()`, `M.detect_profile(cwd)`, `M.suggest(branch, main)` — Task 간 동일.
- **Review Focus 5개** → 1·3: Task 4 테스트 `두 번째 실행`과 `New-Link` 폴백(hardlink 단언 주의 명시). 2: Task 4 테스트 `첫 실행 백업`. 4: Task 4 테스트가 실제 저장소 경로(공백·한글)에서 돈다. 5: Task 3 테스트 `local.lua 없음`.

---

## Task 4 수정 (2026-10-01, 작업 세션 질문 2 에 대한 결정 — 사용자: "1 과 3 을 같이")

**결정**: hardlink 폴백을 **제거**한다. 링크 전략은 다음 순서다.
1. symlink 시도(개발자 모드가 켜져 있거나 관리자면 성공).
2. 일반 권한이고 symlink 가 불가하면 **자기 자신을 관리자 권한으로 다시 실행**(UAC 창). 성공하면 그 프로세스가 symlink 로 설치한다.
3. 사용자가 UAC 를 취소하거나 승격이 실패하면 폴더는 junction, **파일은 복사 + 경고**("재설치로 갱신, 개발자 모드를 켜면 symlink").
4. README 는 개발자 모드를 권장 요구사항으로 적는다.

복사 모드에서도 uninstall·멱등이 성립하도록 **매니페스트**(`<HomeDir>\.agent-env-manifest.json`)를 둔다. install 이 만든 모든 경로와 방식을 기록하고, uninstall 과 두 번째 install 은 매니페스트의 경로를 "우리가 만든 것"으로 보고 백업하지 않는다.

**Interfaces 변경**:
- `New-Link -Link -Target [-CanSymlink <bool>]` 반환: `'symlink' | 'junction' | 'copy' | 'skip(이미 링크)' | 'skip(동일 복사본)'`.
- 새 함수 `Test-SymlinkCapable` → `[bool]`. 새 함수 `Read-Manifest -Path` → `[hashtable]` / `Write-Manifest -Path -Entries <hashtable>`.
- `install.ps1` 새 스위치 `-NoElevate`(승격된 재실행이 자기 자신에게 붙인다. 사용자가 직접 쓸 일은 없다).
- `Backup-Item` 에 `-Manifest <hashtable>` 추가: `$Manifest.ContainsKey($Path)` 면 백업하지 않고 `$null`.

**`scripts/lib.ps1` 변경 코드**:
```powershell
function Test-SymlinkCapable {
  $f = Join-Path $env:TEMP ('symtest-' + [guid]::NewGuid() + '.txt'); $l = "$f.lnk"
  Set-Content -LiteralPath $f -Value 'x'
  try { New-Item -ItemType SymbolicLink -Path $l -Target $f -ErrorAction Stop | Out-Null; Remove-Item -LiteralPath $l -Force; return $true }
  catch { return $false }
  finally { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
}

function Read-Manifest { param([string]$Path)
  $m = @{}
  if (Test-Path -LiteralPath $Path) {
    $j = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $j.PSObject.Properties) { $m[$p.Name] = $p.Value }
  }
  return $m
}
function Write-Manifest { param([string]$Path, [hashtable]$Entries)
  $o = New-Object PSObject
  foreach ($k in ($Entries.Keys | Sort-Object)) { $o | Add-Member NoteProperty $k $Entries[$k] }
  $o | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding UTF8
}

# Backup-Item: 매니페스트에 있는 경로(이전 설치가 만든 링크/복사본)는 백업하지 않는다.
function Backup-Item {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$BackupRoot,
        [Parameter(Mandatory)][string]$RelName, [hashtable]$Manifest = @{})
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  if (Test-IsLink $Path) { return $null }
  if ($Manifest.ContainsKey($Path)) { return $null }
  $dest = Join-Path $BackupRoot $RelName
  $parent = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Move-Item -LiteralPath $Path -Destination $dest -Force
  return $dest
}

# New-Link: symlink → (폴더) junction / (파일) 복사. hardlink 는 쓰지 않는다.
function New-Link {
  param([Parameter(Mandatory)][string]$Link, [Parameter(Mandatory)][string]$Target, [bool]$CanSymlink = $true)
  if (Test-IsLink $Link) { return 'skip(이미 링크)' }
  $isDir = (Get-Item -LiteralPath $Target).PSIsContainer
  if ((Test-Path -LiteralPath $Link) -and -not $isDir) {
    # 이전 설치의 복사본이면 내용이 같을 때 건너뛰고, 다르면 갱신한다.
    if ((Get-FileHash -LiteralPath $Link).Hash -eq (Get-FileHash -LiteralPath $Target).Hash) { return 'skip(동일 복사본)' }
    Remove-Item -LiteralPath $Link -Force
  } elseif (Test-Path -LiteralPath $Link) {
    throw "링크 위치에 실제 폴더가 남아 있습니다(백업 실패?): $Link"
  }
  $parent = Split-Path -Parent $Link
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  if ($CanSymlink) {
    try { New-Item -ItemType SymbolicLink -Path $Link -Target $Target -ErrorAction Stop | Out-Null; return 'symlink' } catch { }
  }
  if ($isDir) { New-Item -ItemType Junction -Path $Link -Target $Target -ErrorAction Stop | Out-Null; return 'junction' }
  Copy-Item -LiteralPath $Target -Destination $Link -Force
  return 'copy'
}
```

**`install.ps1` 변경 코드** — `param` 에 `[switch]$NoElevate` 추가. 요구사항 확인 직후에 삽입:
```powershell
# 0b. symlink 가능 여부. 불가하면 관리자 권한으로 자기 자신을 다시 실행한다(UAC). 취소되면 복사 폴백.
$canSymlink = Test-SymlinkCapable
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $canSymlink -and -not $isAdmin -and -not $NoElevate -and -not $DryRun) {
  Say '  symlink 권한이 없습니다(개발자 모드 꺼짐). 관리자 권한으로 다시 실행합니다 — UAC 창을 승인하세요. 취소하면 파일은 복사로 폴백합니다.'
  $q = { param($s) '"' + $s + '"' }
  $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(& $q $PSCommandPath),'-NoElevate',
               '-HomeDir',(& $q $HomeDir),'-NvimDir',(& $q $NvimDir),'-RbmRoot',(& $q $RbmRoot),'-DocsRoot',(& $q $DocsRoot))
  if ($TrustedProjects.Count -gt 0) { $argList += '-TrustedProjects'; $argList += (($TrustedProjects | ForEach-Object { & $q $_ }) -join ',') }
  if ($SkipPlugins) { $argList += '-SkipPlugins' }
  try {
    $p = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru -ErrorAction Stop
    Say ("  관리자 실행 종료 코드: {0}. 로그: {1}" -f $p.ExitCode, (Join-Path $HomeDir '.agent-env-backup\install-last.log'))
    exit $p.ExitCode
  } catch {
    Say '  관리자 실행이 취소됐습니다. 파일은 복사로 폴백합니다(설정 › 시스템 › 개발자용 › 개발자 모드를 켜면 다음 설치부터 symlink).'
  }
}
if ($NoElevate) {
  New-Item -ItemType Directory -Force (Join-Path $HomeDir '.agent-env-backup') | Out-Null
  Start-Transcript -Path (Join-Path $HomeDir '.agent-env-backup\install-last.log') -Force | Out-Null
}
$manifestPath = Join-Path $HomeDir '.agent-env-manifest.json'
$prevManifest = Read-Manifest -Path $manifestPath
$newManifest = @{}
```
`Do-Link` 는 `Backup-Item ... -Manifest $prevManifest` 와 `New-Link ... -CanSymlink $canSymlink` 를 호출하고 `$newManifest[$link] = $how` 를 기록한다. `Do-Template` 은 치환 결과를 임시 파일에 만든 뒤 기존 파일과 해시가 같으면 `'skip(동일)'`, 다르면 (매니페스트에 없을 때만) 백업 후 교체하고 `$newManifest[$out] = '생성'`. 요약 출력 직전에 `Write-Manifest -Path $manifestPath -Entries $newManifest`, 마지막에 `if ($NoElevate) { Stop-Transcript | Out-Null }`.

**`uninstall.ps1` 변경** — 링크 목록을 하드코딩하지 않고 매니페스트를 읽는다:
```powershell
$manifestPath = Join-Path $HomeDir '.agent-env-manifest.json'
$m = Read-Manifest -Path $manifestPath
foreach ($p in $m.Keys) {
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $item = Get-Item -LiteralPath $p -Force
  if ($item.PSIsContainer -and (Test-IsLink $p)) { $item.Delete() }       # 폴더 링크: 링크만 제거
  elseif ($item.PSIsContainer) { throw "매니페스트의 폴더가 링크가 아닙니다. 수동 확인 필요: $p" }
  else { Remove-Item -LiteralPath $p -Force }                              # 파일 링크·복사본·생성 파일
  Write-Host "제거: $p ($($m[$p]))"
}
Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
```
그 뒤 백업 복원 로직은 기존 그대로.

**`tests/Install.Tests.ps1` 변경** — `BeforeAll` 에 `$Cap = Test-SymlinkCapable` 를 두고 `$run` 에 `-NoElevate` 를 붙인다(테스트가 UAC 를 띄우지 않도록). 파일 링크 단언은 환경에 따라 분기한다:
```powershell
  It '지침 파일이 저장소를 가리킨다(symlink) 또는 같은 내용의 복사본이다(폴백)' {
    if ($Cap) { (Get-Item "$Home2\.claude\CLAUDE.md").LinkType | Should -Be 'SymbolicLink' }
    else      { (Get-Item "$Home2\.claude\CLAUDE.md").LinkType | Should -BeNullOrEmpty }
    Get-Content "$Home2\.claude\CLAUDE.md" -Raw | Should -Be (Get-Content "$Repo\claude\CLAUDE.md" -Raw)
  }
  It '매니페스트가 만들어지고 두 번째 실행에서 백업이 늘지 않는다' {
    Test-Path "$Home2\.agent-env-manifest.json" | Should -BeTrue
    $before = (Get-ChildItem "$Home2\.agent-env-backup").Count
    & $run | Out-Null
    (Get-ChildItem "$Home2\.agent-env-backup").Count | Should -Be $before
  }
  It 'uninstall 뒤 저장소 정본이 바뀌지 않는다(복사 폴백 환경 포함)' {
    $hash = (Get-FileHash "$Repo\claude\CLAUDE.md").Hash
    & "$Repo\uninstall.ps1" -HomeDir $Home2 -NvimDir $Nvim2 | Out-Null
    (Get-FileHash "$Repo\claude\CLAUDE.md").Hash | Should -Be $hash
    Get-Content "$Home2\.claude\CLAUDE.md" | Should -Be '옛 지침'
  }
```
일반 권한에서 돌리면 복사 폴백 경로를, 관리자 PowerShell 에서 돌리면 symlink 경로를 검증하게 된다. Task 6 Step 4 의 기대값 `LinkType` 은 `SymbolicLink`(개발자 모드 켬/관리자) 또는 비어 있음(복사) 둘 다 허용.

**README 변경** — 요구사항에 "**개발자 모드(설정 › 시스템 › 개발자용) 권장.** 꺼져 있으면 설치 중 관리자 권한(UAC)을 요청하고, 취소하면 파일은 복사본으로 설치돼 `git pull` 뒤 `install.ps1` 재실행이 필요하다."

## 작업 세션 판단 승인 기록 (2026-10-01)
- Task 5 를 Task 4 보다 먼저 수행(`install.ps1` 이 `claude\skills\agent-init` 를 링크 대상으로 필요). Task 5 Step 6 은 Task 6 으로.
- `Do-Template` 은 치환 결과가 기존과 같으면 건너뛴다(위 수정에 포함).
- Task 3·4·6·README 의 nvim 테스트 명령은 `set rtp^=nvim`(앞 삽입). agent-hub 기존 테스트는 `$env:XDG_CONFIG_HOME` 을 저장소 루트로 일시 지정해 실행.

---

## Task 6 README 보강 (2026-10-01 사용자 요청)

README 는 GitHub 에서 "이 저장소가 무엇인지"를 처음 보는 사람이 이해하게 써야 한다. Task 6 Step 6 의 README 초안에 아래 두 절을 **추가**한다(기존 절은 유지).

**(1) 맨 위 소개 문단을 다음으로 교체:**

```markdown
# AI-Settings

> Claude Code · Codex CLI · Neovim(LazyVim) 을 묶어 **"계획은 최상위 모델이, 작업은 중간 모델이, 노동은 하위 모델이"** 하는 방식으로 일하기 위한 설정 저장소. 어떤 Windows PC 에서든 clone 과 설치 한 번으로 같은 환경이 된다.

이 저장소에 들어 있는 것:
- **전역 지침** (`claude/CLAUDE.md`) — 모든 AI 세션이 따르는 규칙: 역할 분리, git 권한, 언어, 핸드오프, 머지 절차
- **서브에이전트 5개** (`claude/agents/`) — researcher / implementer / reviewer / planner / planner-fallback
- **Codex 프로필 7개** (`codex/`) — Claude 쪽 역할과 1:1 로 대응하는 모델·권한 조합
- **Neovim 에이전트 허브** (`nvim/lua/config/agent/`) — 세션을 띄우고, 계획 세션에서 작업 세션으로 넘기고, 끝나면 닫고, worktree 를 머지하는 자동화
- **훅** (`claude/hooks/agent-done.js`) — 작업이 끝나면 세션을 스스로 닫는다
- **`/agent-init` 스킬** — 새 프로젝트에 프로젝트 고유 파일을 만들어 준다
```

**(2) "구조" 절 앞에 "작동 방식 — AI 들이 어떻게 움직이는가" 절 추가:**

```markdown
## 작동 방식 — AI 들이 어떻게 움직이는가

### 역할
| 세션 | 모델 | 하는 일 | 못 하는 일 |
|---|---|---|---|
| **계획 세션** | Claude Fable 5.1 (Plan Mode) / Codex `gpt-6-astra` | 사용자와 대화하며 설계·계획 문서 작성, 결정 | 파일 수정(읽기 전용) |
| **작업 세션** | Claude Opus 5 / Codex `gpt-6.1-sol` | 계획대로 구현을 지휘, 리뷰 직접 수행 | 계획에 없는 설계 판단(멈추고 묻는다), 커밋·머지·push |
| **서브에이전트** | Sonnet 5 / Codex `gpt-6-luna` | 조사(`researcher`)·구현(`implementer`) 노동 | 사용자와 대화 |

왜 이렇게 나누는가: 비싼 모델은 "아직 정해지지 않은 것을 정하는 데"만 쓴다. 조사·구현은 하위가 하고 **요약만** 올려서 상위 세션의 컨텍스트에 원문이 쌓이지 않게 한다.

### 한 작업의 흐름
```
사용자 ──"이거 하고 싶어"──▶ 계획 세션 (Fable)
                               │  researcher 에게 조사 위임 → 결론만 받음
                               │  설계 문서 → 구현 계획 문서 (docs/superpowers/)
                               │  영향 범위 표 · 변경 요청 로그 포함
사용자 ──"작업 시작"────────▶ │
                               ▼  AgentHandoff (nvim 허브)
                        작업 세션 (Opus) ── 별도 터미널, 브랜치/worktree 지정
                               │  implementer 에게 Task 단위 구현 위임 (TDD)
                               │  리뷰는 직접 · 무단 커밋 점검
                               │  계획에 없는 판단 필요 → .agent-shared.md 에 [QUESTION] → 멈춤
계획 세션 ◀── 감시 ───────────┤     계획 세션이 사용자에게 묻고 답을 send()
                               │
                               ▼  완료 보고 + [AGENT-DONE]
                        agent-done.js 훅이 세션을 닫음
사용자 ◀── 완료 보고(변경 파일·검증 결과) ── 계획 세션
```

### 세션 간 통신
- **`.agent-shared.md`** (프로젝트 루트, gitignore) — 세션들이 서로 남기는 메모. 질문은 `[QUESTION from=...]`, 답은 `[ANSWER ...]`.
- **nvim 허브 원격 호출** — `AgentHandoff(...)` 로 세션 생성·브리핑 전달, `terminal.send(id, 본문)` 로 메시지 주입, `AgentDone(...)` 로 종료. 계획 세션이 작업 세션을 감시하고 답을 넣어 준다. 사용자가 옮겨 적지 않는다.
- **`[AGENT-DONE]` 마커** — 작업 세션이 완료 보고 끝에 찍으면 Stop 훅(Claude)/notify(Codex)가 세션을 닫는다. `AGENT_SESSION_ROLE=work` 인 세션만 닫혀 계획 세션이 실수로 닫히지 않는다.

### git 규칙 (모든 세션 공통)
- `main` 에서는 쓰지 않는다. 첫 쓰기 전에 브랜치를 확인한다.
- 커밋·머지는 사용자가 지시할 때만. **먼저 제안하지도 않는다.** push 는 사용자만.
- 병렬 작업은 `<repo>/worktrees/<name>` 에 격리하고 `:AgentMerge` 로 2~4단계 머지 조정(전략 판단 → 충돌 해소 → 양쪽 기능 검수 → worktree 정리).

### Claude ↔ Codex
같은 지침(`CLAUDE.md` = `AGENTS.md` 링크)을 읽고 같은 역할 체계로 움직인다. 큰 변경 뒤에는 `codex --profile deep-review`(astra)가 **다른 벤더 관점**으로 교차 검수한다.
```

---

### Task 7: 핸드오프 브리핑 전달 보강 (2026-10-01 사용자 요청 — "프롬프트 감지 + 시간차")

**Files:**
- Modify: `nvim/lua/config/agent/terminal.lua:117-137` (`M.send`), 새 함수 `M.wait_ready`
- Modify: `nvim/lua/config/agent/handoff.lua:70-75`
- Test: `nvim/tests/agent-hub/handoff-send.lua`

**문제**: `handoff.lua` 가 spawn 후 **고정 3초** 뒤 준비 확인 없이 `terminal.send` 를 호출하고, `send` 는 본문 직후 **300ms** 에 Enter 를 보낸다. TUI 가 늦게 뜨면 브리핑이 유실되고, 붙여넣기 처리 중이면 Enter 가 무시된다. 반환값도 버려져 실패를 알 수 없다.

**Interfaces:**
- Produces: `terminal.wait_ready(id, opts, cb)` — `opts = { pattern = <Lua 패턴>, interval_ms = 500, timeout_ms = 30000, settle_ms = 1000 }`. 터미널 버퍼 마지막 40줄에 `pattern` 이 나타나면 `settle_ms` 뒤 `cb(true)`, 시간 초과면 `cb(false)`.
- Produces: `terminal.send(id, text, opts)` — `opts.enter_delay_ms`(기본 **1000**, 기존 300). 반환 `ok, err` 는 그대로.
- `handoff.lua` 는 `wait_ready` → `send` 순으로 호출하고 실패 시 `vim.notify(..., ERROR)`.
- 프롬프트 패턴: Claude `"❯"`, Codex `"›"`. `menu.lua` 의 agent key 로 고른다. 두 문자는 UTF-8 멀티바이트이므로 Lua 패턴에서 `string.find(line, pat, 1, true)`(plain) 로 찾는다.

- [ ] **Step 1: 실패하는 테스트**

`nvim/tests/agent-hub/handoff-send.lua` — 가짜 에이전트(node)가 1.5초 뒤 프롬프트를 찍고, 받은 입력을 stdin 에서 읽어 `GOT:<본문>` 으로 되쏜다. 테스트는 (a) 프롬프트가 뜨기 전에는 전송하지 않고, (b) 본문과 Enter 가 모두 도달해 `GOT:` 줄이 버퍼에 생기는지 확인한다.
```lua
-- 실행(저장소 루트): $env:XDG_CONFIG_HOME = (Get-Location).Path; nvim --headless -u nvim/init.lua -l nvim/tests/agent-hub/handoff-send.lua
local terminal = require("config.agent.terminal")
local node = vim.fn.exepath("node")
local js = [[
  let n=0; const rl=require('readline').createInterface({input:process.stdin});
  setTimeout(()=>{ process.stdout.write('\n❯ \n'); }, 1500);
  rl.on('line', l => { if (l.length) process.stdout.write('GOT:' + l + '\n'); });
  setInterval(()=>{}, 1000);
]]
local id = assert(terminal.spawn({ agent = "Claude", cmd = { node, "-e", js }, cwd = vim.fn.getcwd(), env = {} }))
local e = terminal.registry[id]
local sent_at, ready_at
terminal.wait_ready(id, { pattern = "❯", timeout_ms = 10000, settle_ms = 500 }, function(ready)
  assert(ready, "준비 감지 실패(10초)")
  ready_at = vim.loop.now()
  assert(ready_at - e.started_at >= 1500, "프롬프트가 뜨기 전에 준비로 판정됨")
  assert(terminal.send(id, "브리핑 본문 테스트"))
  sent_at = vim.loop.now()
end)
vim.wait(15000, function()
  if not sent_at then return false end
  local lines = vim.api.nvim_buf_get_lines(e.buf, 0, -1, false)
  for _, l in ipairs(lines) do if l:find("GOT:브리핑 본문 테스트", 1, true) then return true end end
  return false
end, 200)
local lines = vim.api.nvim_buf_get_lines(e.buf, 0, -1, false)
local got = false
for _, l in ipairs(lines) do if l:find("GOT:브리핑 본문 테스트", 1, true) then got = true end end
assert(got, "본문+Enter 가 에이전트에 도달하지 않음")
assert(vim.loop.now() - sent_at >= 1000, "Enter 지연이 1초 미만")
print("ok: handoff-send")
vim.fn.jobstop(e.chan)
os.exit(0)
```
`e.started_at` 은 이 Task 에서 `spawn` 이 레지스트리에 `started_at = vim.loop.now()` 를 기록하도록 한 줄 추가한다.

- [ ] **Step 2: 실행해 실패 확인** — `wait_ready` 없음으로 FAIL.

- [ ] **Step 3: `terminal.lua` 수정**

`spawn` 의 레지스트리 등록부에 `started_at = vim.loop.now()` 추가. `M.send` 와 새 `M.wait_ready`:
```lua
--- 터미널 버퍼에 프롬프트가 나타날 때까지 기다린다(에이전트 CLI 기동 대기).
--- @param id integer
--- @param opts { pattern: string, interval_ms?: integer, timeout_ms?: integer, settle_ms?: integer }
--- @param cb fun(ready: boolean)
function M.wait_ready(id, opts, cb)
  local e = M.registry[id]
  if not e then cb(false); return end
  local interval, timeout, settle = opts.interval_ms or 500, opts.timeout_ms or 30000, opts.settle_ms or 1000
  local waited = 0
  local function tick()
    if not vim.api.nvim_buf_is_valid(e.buf) then cb(false); return end
    local n = vim.api.nvim_buf_line_count(e.buf)
    local lines = vim.api.nvim_buf_get_lines(e.buf, math.max(0, n - 40), n, false)
    for _, l in ipairs(lines) do
      if l:find(opts.pattern, 1, true) then
        -- 프롬프트가 보여도 TUI 가 아직 그리는 중일 수 있어 잠시 더 둔다.
        vim.defer_fn(function() cb(true) end, settle)
        return
      end
    end
    waited = waited + interval
    if waited >= timeout then cb(false); return end
    vim.defer_fn(tick, interval)
  end
  tick()
end

--- 터미널에 문자열을 주입하고 잠시 뒤 Enter 로 제출한다.
--- 본문과 Enter 를 한 번에 보내면 긴 본문이 붙여넣기로 인식돼 "\r" 이 줄바꿈이 된다.
--- @param id integer
--- @param text string
--- @param opts { enter_delay_ms?: integer }|nil
--- @return boolean ok, string|nil err
function M.send(id, text, opts)
  local e = M.registry[id]
  if not e then
    return false, "없는 터미널 id: " .. tostring(id)
  end
  local ok, err = pcall(vim.fn.chansend, e.chan, text)
  if not ok then
    return false, tostring(err)
  end
  local chan = e.chan
  vim.defer_fn(function()
    pcall(vim.fn.chansend, chan, "\r")
  end, (opts and opts.enter_delay_ms) or 1000)
  return true, nil
end
```

- [ ] **Step 4: `handoff.lua:70-75` 교체**

```lua
  -- 에이전트 CLI 가 뜨기까지 시간이 걸린다. 프롬프트가 보일 때까지 기다렸다가 보낸다(최대 30초).
  local prompt = build_prompt(o)
  local pattern = agent_key == "codex" and "›" or "❯"
  terminal.wait_ready(id, { pattern = pattern }, function(ready)
    if not ready then
      vim.notify(string.format("핸드오프 id=%d: 30초 안에 프롬프트가 뜨지 않아 브리핑을 보내지 못했습니다. 직접 붙여넣으세요.", id), vim.log.levels.ERROR)
      return
    end
    local ok, err = terminal.send(id, prompt)
    if not ok then
      vim.notify(string.format("핸드오프 id=%d: 브리핑 전송 실패 — %s", id, tostring(err)), vim.log.levels.ERROR)
    end
  end)
```
`init.lua:67`(`M.send(header .. ...)`)와 `merge.lua:233` 의 기존 `send` 호출은 시그니처가 호환되므로(세 번째 인자 생략) 그대로 둔다.

- [ ] **Step 5: 테스트 통과 확인** — `ok: handoff-send`.

- [ ] **Step 6: 실제 확인** — Task 6 설치가 끝난 뒤(nvim 폴더가 저장소를 가리킴) nvim 을 새로 열고 `AgentHandoff({'agent':'claude','session':'work','plan_doc':'<아무 md>','worktree':'<저장소>','strategy':'테스트'})` 를 한 번 호출해 브리핑이 입력창에 들어가고 실행되는지 본다. 확인 뒤 그 세션은 `/exit`. Codex 프롬프트 문자 `›` 가 실제와 다르면 `codex --profile work` 를 열어 첫 프롬프트 줄을 확인하고 패턴을 고친 뒤 보고한다.

- [ ] **Step 7: 변경 파일 목록 보고**

---

## Task 7 보강 (2026-10-01 14:0x — 실제 핸드오프 id=3 관찰 결과)

**관찰**: 핸드오프 브리핑이 입력창에 **들어갔지만 제출되지 않았다.** 이후 계획 세션이 `chansend(chan, "\r")` 을 따로 보내도 두 번 무시됐고, `"\n"` 또는 세 번째 `"\r"` 뒤에야 실행이 시작됐다. 즉 "Enter 지연을 늘리는 것"만으로는 부족하고, **제출됐는지 확인하고 안 됐으면 다시 보내는** 재시도가 필요하다. (이 관찰은 설치 전에 뜬 허브 nvim 의 옛 코드 경로에서 나온 것이지만, Enter 가 무시되는 현상 자체는 새 코드에도 해당한다.)

**수정**: `terminal.send` 가 Enter 를 보낸 뒤 **제출 확인 → 미제출 시 재시도**를 한다.

- 제출 판정: 터미널 버퍼 마지막 40줄에서 `❯`(Codex `›`) 로 시작하는 줄 뒤에 **본문의 첫 20자**가 남아 있으면 미제출. 입력창이 비어 있으면(`❯` 줄에 본문 없음) 제출로 본다.
- 재시도: 1초 간격, 최대 5회. 홀수 회는 `"\r"`, 짝수 회는 `"\n"`. 5회 뒤에도 미제출이면 `vim.notify(..., WARN)` "브리핑이 입력창에 남아 있습니다. Enter 를 눌러 주세요."
- 반환값은 그대로 `ok, err`(동기). 확인·재시도는 비동기(`vim.defer_fn`)로 진행한다.

```lua
--- 입력창에 본문이 남아 있는지(미제출) 검사한다.
local function still_pending(buf, head, prompt)
  if not vim.api.nvim_buf_is_valid(buf) then return false end
  local n = vim.api.nvim_buf_line_count(buf)
  local lines = vim.api.nvim_buf_get_lines(buf, math.max(0, n - 40), n, false)
  local seen_prompt = false
  for _, l in ipairs(lines) do
    if l:find(prompt, 1, true) then seen_prompt = true end
    if seen_prompt and l:find(head, 1, true) then return true end
  end
  return false
end

function M.send(id, text, opts)
  local e = M.registry[id]
  if not e then
    return false, "없는 터미널 id: " .. tostring(id)
  end
  local ok, err = pcall(vim.fn.chansend, e.chan, text)
  if not ok then
    return false, tostring(err)
  end
  local chan, buf = e.chan, e.buf
  local prompt = (opts and opts.prompt) or "❯"
  local head = text:sub(1, 20)
  local tries, max_tries = 0, (opts and opts.max_tries) or 5
  local function submit()
    tries = tries + 1
    pcall(vim.fn.chansend, chan, (tries % 2 == 1) and "\r" or "\n")
    vim.defer_fn(function()
      if not still_pending(buf, head, prompt) then return end
      if tries >= max_tries then
        vim.notify(string.format("터미널 id=%d: 브리핑이 입력창에 남아 있습니다. Enter 를 눌러 주세요.", id), vim.log.levels.WARN)
        return
      end
      submit()
    end, 1000)
  end
  vim.defer_fn(submit, (opts and opts.enter_delay_ms) or 1000)
  return true, nil
end
```
`handoff.lua` 는 `terminal.send(id, prompt, { prompt = pattern })` 로 프롬프트 문자를 넘긴다.

**테스트 추가** (`nvim/tests/agent-hub/handoff-send.lua` 또는 단위 테스트): 가짜 레지스트리 버퍼에 `❯ <본문>` 줄을 둔 채 `send` 를 호출하면 1초 간격으로 `chansend` 가 최대 5회 호출되는지(스텁으로 횟수·페이로드 `"\r"`,`"\n"` 교대 확인), 버퍼의 본문을 지우면 재시도가 멈추는지 확인한다.

**사용자 확인 필요 항목에 추가**: 허브 nvim 을 재시작한 뒤의 첫 핸드오프에서 브리핑이 자동 제출되는지.
