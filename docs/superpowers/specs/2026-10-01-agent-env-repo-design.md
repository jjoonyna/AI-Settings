# AI 에이전트 작업 환경 저장소(agent-env) 설계

상태: 구현 완료 (2026-10-01, Task 0~7 + 보정. 이 PC 설치 완료. 사용자 확인 2건 남음 — 아래 미결 참고)
작성: 2026-10-01 Claude Fable 5.1 (계획 세션)
저장소: `C:/Users/fmtes/OneDrive/바탕 화면/AI-Settings` (origin `https://github.com/jjoonyna/AI-Settings.git`, 작업 브랜치 `feat/agent-env-bootstrap`). OneDrive 안이라는 점은 사용자가 인지하고 그대로 진행하기로 함(2026-10-01).

## 1. 목적

지금 `~/.claude`, `~/.codex`, `AppData/Local/nvim`, `C:\ExRBM\rbm` 네 곳에 흩어진 AI 에이전트 작업 환경을
GitHub 저장소 하나로 묶어, **다른 PC·다른 프로젝트에서 `git clone` + `install.ps1` 한 번으로 같은 방식**
(계획 세션/작업 세션 분리, 서브에이전트, 핸드오프, `:AgentMerge`, Codex 프로필)으로 일할 수 있게 한다.

성공 기준:
1. 새 Windows PC 에서 clone → `install.ps1` → `claude login`/`codex login` 만 하면 rbm 에서 쓰던 전역 기능이 전부 동작한다.
2. 새 프로젝트 폴더에서 `/agent-init` 한 번으로 프로젝트 고유 파일(규약 `CLAUDE.md`, `docs/impact.md` + 생성기, `.gitignore` 항목)이 만들어진다.
3. 저장소에서 `git pull` 하면 로컬 설정에 즉시 반영된다(심볼릭 링크).

범위 밖: macOS/Linux 지원(`agent-done.js` 가 PowerShell 전용). 인증 정보 동기화(절대 넣지 않음).

## 2. 두 층 구분 (조사 결과 2026-10-01)

| 층 | 내용 | 현재 위치 | 저장소 처리 |
|---|---|---|---|
| 전역 | 지침 `CLAUDE.md`(= `AGENTS.md`), 서브에이전트 5개, `hooks/agent-done.js`, `statusline-command.ps1`, Codex 프로필 7개, `config.toml`, nvim 전체, 플러그인 목록 | `~/.claude`, `~/.codex`, `AppData/Local/nvim` | 저장소에 포함, 설치 시 링크 |
| 프로젝트 고유 | 코드 규약 `CLAUDE.md`/`AGENTS.md`, `docs/impact.md`, `docs/tools/gen-impact.mjs`, `.agent-shared.md`, `.claude/settings.local.json` | `C:\ExRBM\rbm` (규약 문서는 gitignore 됨) | 저장소에 넣지 않고 `/agent-init` 스킬이 프로젝트마다 생성 |
| 제외 | `.credentials.json`, `daemon/*.key`, `auth.json`, `plugins/cache`, `projects/*/memory`, `file-history`, `jobs`, nvim `backups/`·`*.bak`·`.agent-shared.md` | — | `.gitignore` 와 설치 스크립트 모두에서 제외 |

핵심 사실: 영향 지도 생성기 `gen-impact.mjs` 는 rbm 의 테이블·엔드포인트 구조에 종속이라 다른 프로젝트에 그대로 쓸 수 없다.
"영향 범위 절이 있어야 한다", "`.agent-shared.md` 로 세션 간 공유한다" 같은 **절차**는 전역 지침에 있어 자동으로 따라온다.

## 3. 저장소 구조

```
AI-Settings/
  install.ps1               ← 심볼릭 링크 생성 + 템플릿 치환 + 플러그인 설치 + 검증
  uninstall.ps1             ← 링크 제거, 백업 복원
  README.md                 ← 설치 절차·요구사항·수동 단계(login)
  claude/
    CLAUDE.md               ← 전역 지침 정본 (하나)
    settings.json.tmpl      ← {{HOME}} 치환
    agents/*.md             ← implementer, planner, planner-fallback, researcher, reviewer
    hooks/agent-done.js
    statusline-command.ps1
    skills/agent-init/SKILL.md
    plugins.json            ← 마켓플레이스 이름 + 플러그인 목록만 (캐시 제외)
  codex/
    config.toml.tmpl        ← notify 경로 {{HOME}}, trust 경로 {{PROJECTS}} 치환
    plan.config.toml  plan-fallback.config.toml  work.config.toml
    research.config.toml  build.config.toml  review.config.toml  deep-review.config.toml
    CODEX-사용안내.md
  nvim/                     ← 현재 AppData/Local/nvim 전체 (backups, *.bak, .agent-shared.md 제외)
    lua/config/agent/local.lua.tmpl  ← 머신 종속값(프로젝트 루트, JDK, python) 분리
  docs/superpowers/specs/, plans/
  .gitignore
```

## 4. 핵심 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | 지침 정본은 `claude/CLAUDE.md` 하나. `~/.codex/AGENTS.md` 는 설치 시 심볼릭 링크 | 현재 두 사본을 수동 동기화 중 — 한쪽만 고치면 어긋남 |
| D2 | 머신 고유값은 `.tmpl` + `install.ps1` 치환 | §5 하드코딩 지점 목록 |
| D3 | 복사가 아니라 **심볼릭 링크** (`New-Item -ItemType SymbolicLink`, 실패 시 Junction/HardLink 폴백) | `git pull` 즉시 반영, 로컬 수정이 저장소에 바로 잡힘 |
| D4 | 프로젝트 고유 파일은 `/agent-init` 스킬이 생성 | 영향 지도가 프로젝트 구조 종속 — 설치 시점엔 대상 프로젝트를 모름 |
| D5 | 플러그인은 목록만 저장, 설치는 `claude plugin marketplace add` + `claude plugin install` 로 재현 | `installed_plugins.json` 이 절대경로를 품음 |
| D6 | Codex 모델 매핑은 Claude 등급 대응: Fable↔`gpt-6-astra`(low), Opus↔`gpt-6.1-sol`(medium), Sonnet↔`gpt-6-luna`(medium) | 2026-10-01 사용자 결정, 당일 `~/.codex` 반영 완료 |
| D7 | Windows 전용으로 시작 | 훅·statusline·nvim 런처가 PowerShell 종속 |
| D8 | `settings.json` 의 개인 취향 값(`language`, `effortLevel`, `tui`, `model`, `defaultMode`)도 저장소에 포함 | 2026-10-01 사용자 결정 — 어느 PC 에서나 같은 경험 |

## 5. 템플릿 치환 대상 (하드코딩 지점 — 2026-10-01 조사)

| 파일 | 위치 | 현재 값 | 치환 변수 |
|---|---|---|---|
| `claude/settings.json` | Stop 훅 command | `C:\Users\fmtes\.claude\hooks\agent-done.js` | `{{CLAUDE_HOME}}` |
| `claude/settings.json` | statusLine command | `C:\Users\fmtes\.claude\statusline-command.ps1` | `{{CLAUDE_HOME}}` |
| `codex/config.toml` | `notify` | `C:/Users/fmtes/.claude/hooks/agent-done.js` | `{{CLAUDE_HOME}}` |
| `codex/config.toml` | `[projects.'...']` trust 4개 | `c:\exrbm\rbm`, `c:\tomcat\webapps[\exrbm]`, `c:\users\fmtes` | `{{TRUSTED_PROJECTS}}` (설치 인자 배열) |
| `nvim/lua/plugins/lsp.lua:27` | `pythonPath` | `C:/Users/fmtes/.../Python311/python.exe` | `local.lua` 로 이동 |
| `nvim/lua/config/workspace.lua:6,15,20` | `JDK21`, 프로젝트 루트, `c:/docsbackup` | 절대경로 | `local.lua` 로 이동 |
| `nvim/lua/config/agent/worktree.lua:64` | 핫픽스 worktree 규칙 | `C:/ExRBM/rbm-hotfix-<버전>` | `local.lua` 의 `hotfix_root` |
| `nvim/tests/agent-hub/*.lua` | node 경로 | `C:/Program Files/nodejs/node.exe` | `vim.fn.exepath("node")` |
| `nvim/README.md:77` | 예시 cwd | `C:/ExRBM/rbm` | 문서 예시로만 유지 |
| `codex/CODEX-사용안내.md:60` | 예시 경로 | `C:\ExRBM\rbm\AGENTS.md` | 문서 예시로만 유지 |

`local.lua.tmpl` 은 설치 시 `local.lua` 로 치환 생성하고 `.gitignore` 한다. nvim 코드는 `pcall(require, "config.local")` 로 읽는다.

## 6. `install.ps1` 동작

입력 인자: `-TrustedProjects @("C:\ExRBM\rbm", ...)` (선택), `-DryRun`.

1. 요구사항 확인: `git`, `node`, `nvim`, `claude`, `codex` 가 PATH 에 있는지. 없으면 어떤 것이 없는지 보고하고 중단.
2. 기존 `~/.claude`, `~/.codex`, `AppData/Local/nvim` 의 대상 파일을 `~/.agent-env-backup/<날짜>/` 로 이동(덮어쓰지 않음). 비밀 파일(`.credentials.json`, `auth.json`, `daemon/`)·런타임 폴더는 **건드리지 않는다.**
3. 심볼릭 링크 생성:
   - `~/.claude/CLAUDE.md` → `claude/CLAUDE.md`, `~/.codex/AGENTS.md` → `claude/CLAUDE.md`
   - `~/.claude/agents`, `hooks`, `statusline-command.ps1`, `skills/agent-init`
   - `~/.codex/*.config.toml`, `CODEX-사용안내.md`
   - `AppData/Local/nvim` 폴더 전체 → `nvim/`
   - 개발자 모드가 꺼져 있어 SymbolicLink 가 실패하면 Junction(폴더)/HardLink(파일)로 폴백하고 그 사실을 출력.
4. 템플릿 치환: `settings.json.tmpl` → `~/.claude/settings.json`, `config.toml.tmpl` → `~/.codex/config.toml`, `local.lua.tmpl` → `nvim/lua/config/local.lua`. 치환 결과물은 링크가 아니라 **생성 파일**이다(머신별로 다르므로).
5. 플러그인: `plugins.json` 을 읽어 `claude plugin marketplace add <repo>` → `claude plugin install <name>@<market>` 실행.
6. 검증 출력: 링크 대상 존재 여부, `claude --version`, `codex --version`, `nvim --headless +q`, `node hooks/agent-done.js --selfcheck`(추가 예정) 결과를 표로 출력.
7. 마지막에 사람이 할 일을 출력: `claude login`, `codex login`, nvim 첫 실행 시 lazy.nvim 플러그인 설치.

멱등: 두 번 실행해도 결과가 같다(이미 링크면 건너뜀).

## 7. `/agent-init` 스킬 (전역 `claude/skills/agent-init/SKILL.md`)

새 프로젝트 루트에서 실행. **파일 쓰기 전 브랜치 확인**(전역 §0 적용 — `main` 이면 중단).

1. `researcher` 로 프로젝트 조사: 언어·빌드 도구·테스트 명령·디렉터리 구조·DB 스키마 위치·API 라우트 위치·i18n 파일.
2. `CLAUDE.md` 초안 생성(rbm 의 절 구조를 골격으로: Language Rules / Documentation Structure / Code Modification Rules / Architecture / Coding Conventions / Comment Rules / Documentation Update Policy / Testing). 조사로 채울 수 없는 칸은 `<!-- TODO: 확인 필요 -->` 로 남긴다.
3. `AGENTS.md` 는 `CLAUDE.md` 의 사본으로 생성(Codex 용).
4. 영향 지도:
   - 조사 결과로 "영향 지도에 넣을 축"(테이블·컬럼·엔드포인트·모듈·값 집합·성질)을 사용자에게 **한 번 확인**받는다.
   - `docs/tools/gen-impact.mjs` 를 그 프로젝트 구조에 맞게 **새로 작성**하고 `docs/impact.md` 를 생성한다. 첫 줄 형식은 rbm 과 동일: `기준: <해시> (<날짜>) · ... 수동 절: ...`.
   - rbm 의 `gen-impact.mjs` 는 스킬 안에 `reference/gen-impact.rbm.mjs` 로 동봉해 참고 예시로만 쓴다.
5. `.gitignore` 에 `.agent-shared.md`, `worktrees/` 추가. `CLAUDE.md`·`AGENTS.md` 는 **git 추적**한다(2026-10-01 결정). 기존 `.gitignore` 에 이 둘이 들어 있으면 제거를 제안한다.
6. `.claude/settings.local.json` 에 그 프로젝트의 빌드·테스트 명령 allow 목록 생성.
7. 완료 보고: 생성 파일 목록과 TODO 칸 목록.

## 8. 영향 범위

이 작업은 rbm 코드에 닿지 않는다. `docs/impact.md` 의 행에 해당하는 변경 없음.
닿는 것은 사용자 홈의 설정 세 곳과 nvim 설정 코드(머신 종속값 분리 리팩터)다.

| 대상 | 변경 |
|---|---|
| `~/.claude` | `CLAUDE.md`·`agents`·`hooks`·`statusline`·`skills/agent-init` 가 링크로 바뀜. `settings.json` 은 생성 파일 |
| `~/.codex` | `AGENTS.md`·프로필 7개·사용안내가 링크로. `config.toml` 은 생성 파일 |
| `AppData/Local/nvim` | 폴더 전체가 링크. `plugins/lsp.lua`·`config/workspace.lua`·`agent/worktree.lua`·`tests/` 에서 절대경로를 `local.lua` 로 분리 |
| `C:\ExRBM\rbm` | 변경 없음 |

## 9. 작업 분할 전략

작업 갈래가 넷이고 파일이 거의 겹치지 않는다. **②병렬 worktree 는 쓰지 않고** 저장소 하나에서 Task 순서로 진행한다(저장소 자체를 새로 만드는 작업이라 worktree 를 가를 본체가 없다).

1. 저장소 골격 + 파일 이관(현재 설정 복사, 제외 목록 적용, `.tmpl` 분리)
2. nvim 머신 종속값 → `local.lua` 분리 리팩터 (nvim 테스트 `tests/agent-hub` 통과 확인)
3. `install.ps1` / `uninstall.ps1` + 이 PC 에서 `-DryRun` → 실제 설치 → 기능 확인(핸드오프, `:AgentMerge` 브리핑, 훅 자동 종료)
4. `/agent-init` 스킬 작성 + 임시 샘플 프로젝트에서 실행 검증
5. README

## 10. 검증

- 이 PC 에서 `install.ps1` 실행 후: `claude` 세션에서 서브에이전트 5개 보임, `codex --profile work` 모델 표시 `gpt-6.1-sol`, nvim `:AgentHubStatus` 동작, `[AGENT-DONE]` 훅 종료 동작.
- 빈 폴더(또는 두 번째 사용자 계정)에서 clone → install → 위 항목 재확인.
- `/agent-init` 을 작은 샘플 프로젝트에서 실행해 7 절의 산출물이 모두 생기는지 확인.

## 변경 요청 로그

| 날짜 | 요청 | 상태 |
|---|---|---|
| 2026-10-01 | Codex 모델 매핑을 Claude 등급에 맞춤 (astra low, 나머지 medium, 최신 세대) | 승인·**완료** (`~/.codex` 직접 반영) |
| 2026-10-01 | 프로젝트 `CLAUDE.md`·`AGENTS.md` 를 git 추적 | 승인 (§7-5 반영) |
| 2026-10-01 | `settings.json` 개인 취향 값(language·effortLevel·tui) 저장소에 포함 | 승인 (D8) |

## 미결 사항

- (사용자 확인) 샘플 프로젝트 `%TEMP%agent-init-sample`(브랜치 dev) 에서 `/agent-init` 대화형 실행
- (사용자 확인) 허브 nvim 재시작 후 첫 핸드오프에서 브리핑 자동 제출 확인, Codex 프롬프트 문자 `›` 실측
- 첫 커밋 전 점검 완료(비밀 파일 없음, local.lua gitignore). 커밋·push 는 사용자 지시로.
