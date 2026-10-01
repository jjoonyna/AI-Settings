# AI-Settings

> Claude Code · Codex CLI · Neovim(LazyVim) 을 묶어 **"계획은 최상위 모델이, 작업은 중간 모델이, 노동은 하위 모델이"** 하는 방식으로 일하기 위한 설정 저장소. 어떤 Windows PC 에서든 clone 과 설치 한 번으로 같은 환경이 된다.

이 저장소에 들어 있는 것:
- **전역 지침** (`claude/CLAUDE.md`) — 모든 AI 세션이 따르는 규칙: 역할 분리, git 권한, 언어, 핸드오프, 머지 절차
- **서브에이전트 5개** (`claude/agents/`) — researcher / implementer / reviewer / planner / planner-fallback
- **Codex 프로필 7개** (`codex/`) — Claude 쪽 역할과 1:1 로 대응하는 모델·권한 조합
- **Neovim 에이전트 허브** (`nvim/lua/config/agent/`) — 세션을 띄우고, 계획 세션에서 작업 세션으로 넘기고, 끝나면 닫고, worktree 를 머지하는 자동화
- **훅** (`claude/hooks/agent-done.js`) — 작업이 끝나면 세션을 스스로 닫는다
- **`/agent-init` 스킬** — 새 프로젝트에 프로젝트 고유 파일을 만들어 준다

## 요구사항
Windows 10/11, PowerShell 5.1, git, Node 22+, Neovim 0.12+, Claude Code 2.1+, Codex CLI 0.159+.
개발자 모드(설정 › 시스템 › 개발자용) 권장. 꺼져 있으면 설치 중 관리자 권한(UAC)을 요청하고, 취소하면 파일은 복사본으로 설치돼 `git pull` 뒤 `install.ps1` 재실행이 필요하다.

## 설치
```powershell
git clone https://github.com/jjoonyna/AI-Settings.git
cd AI-Settings
.\install.ps1 -TrustedProjects @('C:\경로\프로젝트') -RbmRoot 'C:\ExRBM\rbm'
claude login
codex login
```
`-DryRun` 으로 먼저 무엇이 바뀌는지 볼 수 있다. 기존 설정은 `~\.agent-env-backup\<시각>\` 로 이동되고 `.\uninstall.ps1` 이 되돌린다.
설치 상태는 `~\.agent-env-manifest.json` 에 기록되고 `uninstall.ps1` 은 그 목록만 제거한 뒤 **모든 백업 폴더를 오래된 것부터 차례로 복원**한다(같은 파일은 나중 백업이 덮는다. 백업 폴더는 지우지 않는다).

### `install.ps1` 인자
| 인자 | 기본값 | 내용 |
|---|---|---|
| `-TrustedProjects` | 없음 | Codex 가 신뢰할 프로젝트 경로 목록(`config.toml` 의 trust 블록). 사용자 홈은 항상 포함 |
| `-RbmRoot` / `-DocsRoot` | 빈 값 | nvim `local.lua` 의 프로젝트 루트 |
| `-Jdk21` | 자동 탐색 | JDK 21 경로. 미지정 시 `C:\Program Files\Java\jdk-21` → JDK 21 인 `$env:JAVA_HOME` → 빈 값 |
| `-Python` | 자동 탐색 | python.exe 경로. 미지정 시 `%LOCALAPPDATA%\Programs\Python\Python3*\python.exe`(가장 높은 버전) → `py` 런처가 알려 주는 경로 → PATH 의 python(Microsoft Store 별칭 스텁 제외) → 빈 값 |
| `-HomeDir` / `-NvimDir` | `$env:USERPROFILE` / `%LOCALAPPDATA%\nvim` | 설치 대상 위치(테스트용) |
| `-SkipPlugins` | 꺼짐 | Claude 플러그인 등록 단계를 건너뛴다 |
| `-DryRun` | 꺼짐 | 바뀔 목록만 출력하고 아무것도 바꾸지 않는다 |
| `-NoElevate` | 꺼짐 | 관리자 재실행(UAC)을 하지 않는다. 승격된 재실행이 스스로 붙이며, 링크가 이미 있는 PC 에서 생성 파일만 다시 만들 때도 쓴다 |

생성 파일 중 `settings.json` 은 Claude CLI 도 직접 쓴다(예: 플러그인 마켓플레이스 등록). 재실행 시 **기존 파일의 최상위 키 중 템플릿에 없는 것은 보존**하고, 템플릿에 있는 키는 템플릿 값으로 맞춘다.

## 새 프로젝트에서
프로젝트 루트에서 Claude Code 를 열고 `/agent-init`. 코드베이스를 조사해 `CLAUDE.md`·`AGENTS.md`·`docs/impact.md`(+생성기)·`.gitignore` 항목·`.claude/settings.local.json` 을 만든다.

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

# agent-hub 테스트는 저장소 사본을 config 로 보게 하려고 XDG_CONFIG_HOME 을 저장소 루트로 일시 지정한다.
$env:XDG_CONFIG_HOME = (Get-Location).Path; nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/integration.lua
$env:XDG_CONFIG_HOME = (Get-Location).Path; nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/handoff-send.lua
```

## 범위 밖
macOS/Linux(`agent-done.js`·상태줄이 PowerShell 종속), 인증 정보(절대 포함하지 않음), Claude 계정 동기화 스킬(`skills/synced`).
