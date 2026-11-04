# AI-Settings

Windows에서 Claude Code·Codex CLI·Neovim 작업 환경을 설치합니다. 원본 저장소와 독립된 파일을 사용자 영역에 배치하므로 설치 후 clone 폴더를 이동해도 동작합니다.

## 설치

Windows 10/11과 PowerShell 5.1+에서 실행합니다. Git·Node.js·Neovim·Windows Terminal·선택한 AI CLI가 없으면 WinGet/npm으로 설치하고 PATH를 갱신합니다. 디자인·PPT 도구에 필요한 실제 Python도 확인해 설치합니다. WinGet이 없는 PC는 Windows 앱 설치 관리자를 먼저 설치해야 합니다.

```powershell
git clone https://github.com/jjoonyna/AI-Settings.git
.\AI-Settings\install.cmd
```

메뉴에서 **Claude + Codex** 또는 **Codex만** 선택합니다. Neovim·공통 규칙·상태줄·디자인/PPT 스킬이 선택한 구성에 맞춰 자동 설치됩니다. 설정 배치에는 관리자 권한이나 symlink가 필요하지 않지만 필수 프로그램 설치는 설치 관리자가 권한을 요청할 수 있습니다. 다운로드에는 네트워크가 필요합니다.

`install.cmd`는 성공·실패 후 키 입력을 기다리므로 오류가 나도 창이 바로 닫히지 않습니다. 설치 로그는 `~/.ai-settings/logs/install-<시각>.log`에 남습니다. Neovim을 연 것만으로 설정이 설치되지는 않습니다. 설치 완료 후 Neovim을 다시 열고 일반 모드에서 Space → a → a를 누릅니다. Codex 전용 구성이면 Codex만 표시됩니다.

```powershell
# 비대화형 설치
.\install.ps1 -Mode both
.\install.ps1 -Mode codex -Python 'C:\Python312\python.exe'

# 변경 없이 설치 계획 확인
.\install.ps1 -Mode codex -DryRun
```

설치 위치는 기본적으로 `~/.ai-settings`, `~/.codex`, `~/.claude`와 `%LOCALAPPDATA%/nvim`입니다. `-HomeDir`·`-NvimDir`로 격리 설치할 수 있습니다. `-TrustedProjects`, `-Jdk21`, `-Python`, `-RbmRoot`, `-DocsRoot`는 기존 옵션을 유지합니다. `-SkipTools`는 오프라인 진단용으로 외부 스킬·Python 의존성 설치를 건너뛰며, `-SkipPlugins`는 Claude 플러그인 설치를 건너뜁니다.

Codex 설치와 재설치는 승인 정책을 `on-request`, 승인 심사자를 `auto_review`로 설정합니다. 계획 문서 전용 권한과 리뷰 읽기 전용 샌드박스는 유지합니다. Codex 리뷰는 테스트·보고가 샌드박스에 막히면 권한 상승을 요청합니다.

재설치는 관리 항목을 새 규칙으로 갱신하고 개인 MCP·플러그인·권한·지침·PC별 경로·인증·대화 기록은 보존합니다. 같은 관리 항목의 충돌은 배포 규칙을 우선합니다. 기존 폴더 링크는 독립 복사본으로 전환합니다. 백업·소유 파일·외부 도구 버전은 `~/.ai-settings`에 기록합니다. 실패하면 설정 파일 변경을 복구하며 다운로드 캐시·Python 환경은 남을 수 있습니다.

## 사용

`<leader>aa` / `:Agent`에서 새 세션, 선택 재개, 최근 재개를 고릅니다. `<leader>ar` / `:AgentResume`은 선택 재개, `<leader>ac` / `:AgentContinue`는 최근 재개입니다. `<leader>an` / `:AgentNew`에서도 같은 방식을 선택합니다. 재개는 현재 폴더의 CLI 기본 선택기 또는 최근 세션을 사용하며 모델과 제목을 묻지 않습니다. 저장된 이름을 미리 알 수 없어 허브 화면에는 임시 이름이 표시되며 CLI 저장 이름은 바꾸지 않습니다. 재개한 세션에서 위임할 때 정확한 세션 ID의 저장 모델과 규약에 맞는 저장 이름의 역할을 확인하며, 확인할 수 없는 정보는 선택 후 위임을 다시 요청합니다.

계획 세션이 난이도 → 작업량 → 예상 사용량 순서로 작업 모델을 정해 위임합니다. 일반 실행은 Sonnet·Terra, 명확한 작은 작업은 Haiku·Luna를 우선 검토합니다. 동일 모델도 사용할 수 있으며 자동 배정 상한은 호출 모델입니다. 모델 목록과 등급은 `runtime/models.json`, 운영 정본은 `runtime/POLICY.md`입니다. 설치 후에는 같은 파일이 `~/.ai-settings`에 배치됩니다.

작업 결과는 별도 읽기 전용 리뷰를 거칩니다. Claude의 작업은 Claude에 맡기고, Codex 교차 리뷰는 Claude 5시간·주간 사용률 중 유효한 값 하나가 80% 이상일 때 허용합니다. Codex는 Codex만 호출합니다. 한도 정보가 없거나 2분 이상 오래되면 미확인으로 처리합니다.

창 제목과 저장된 세션 이름은 `역할 | 작업 제목`입니다. 상태줄에는 모델·추론 수준·컨텍스트·5시간/주간 한도·작업 위치·브랜치를 표시합니다. Codex는 내장 상태줄 표현을 사용하므로 한도가 잔여량으로 보일 수 있습니다. Claude는 사용률을 표시하며 계정에서 제공하지 않는 값은 `?`로 표시합니다. resume 이름은 초기 `/rename` 전달과 CLI 지원 여부에 따라 확인이 필요합니다.

Claude 리뷰 세션은 Edit·Write·NotebookEdit을 차단하고 `git diff/status/log/show`, 보고 전송(`session.mjs report -`, 표준 입력), WebFetch만 확인 없이 허용합니다. 그 밖의 Bash는 사용자 확인을 거치며, 핸드오프 JSON의 선택 키 `verify_cmds`(문자열 배열)에 적은 검증 명령은 확인 없이 실행됩니다.

핸드오프·보고·사용자 검토 창은 설치된 `session-workflow` 스킬과 `bin/session.mjs`를 사용합니다. 상세 spec·plan은 AI 참고용이고, 사용자는 `docs/user-review/<주제>.md`를 새 창에서 확인한 뒤 Ctrl+D로 닫습니다. 닫기는 승인이 아닙니다. 추가 논의 후 진행 지시를 받으면 문서를 수정하고 검토안을 다시 표시합니다. 일반 진행 갱신이나 완료 때는 창을 열지 않습니다.

프로젝트 내부 문서는 `/docs/` 전체와 생성된 루트 `AGENTS.md`·`CLAUDE.md`를 Git에서 제외합니다. README·CHANGELOG는 루트에 둡니다. `/agent-init`은 기존 문서를 조사해 이 구조를 준비합니다. 커밋·머지·push는 각각 사용자 명시 지시가 있을 때만 실행합니다.

## 외부 스킬

코드 작성은 Ponytail 스킬(full)로 최소 변경을 우선합니다. 리팩토링은 agent-rules-books의 Refactoring·Working Effectively with Legacy Code 스킬을 적용하고, 범위 밖 후보는 `docs/refactoring/<영역>.md`에 기록합니다. 디자인 요청에 맞춰 UI UX Pro Max·frontend-design·Impeccable을 선택해 활용합니다. PPT는 [PPT Master](https://github.com/hugohe3/ppt-master)를 사용합니다. 외부 소스는 `runtime/tool-sources.json`에 고정한 커밋으로 설치하고 원본 라이선스를 보존합니다. Impeccable 엔진은 첫 실행 시 추가 다운로드가 필요할 수 있습니다. Python 의존성은 `~/.ai-settings/python`의 별도 환경에 설치합니다.

## 제거와 복구

```powershell
.\uninstall.ps1
```

설치 당시의 원본으로 관리 항목을 복원합니다. 설치 후 수정된 일반 파일은 보존하고, JSON/TOML 설정에서는 관리 키만 되돌리며 개인 추가 항목은 유지합니다. 백업은 자동 삭제하지 않습니다. 이전 버전 매니페스트만 있는 환경에는 기존 제거 경로를 유지합니다.

## 검증

```powershell
node --test tests/runtime.test.mjs
$env:XDG_CONFIG_HOME = (Get-Location).Path
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/policy.lua
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/integration.lua
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/handoff-send.lua
```

추가 PowerShell 테스트는 Pester 5로 실행합니다. 실제 로그인 계정의 사용률 제공 여부, CLI의 초기 이름 저장·resume, Windows Terminal 검토 창은 로그인한 데스크톱 환경에서 확인해야 합니다.
