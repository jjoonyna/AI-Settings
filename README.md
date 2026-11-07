# AI-Settings

Windows에서 Claude Code·Codex CLI·Neovim 작업 환경을 설치합니다. 원본 저장소와 독립된 파일을 사용자 영역에 배치하므로 설치 후 clone 폴더를 이동해도 동작합니다.

## 설치

Windows 10/11과 PowerShell 5.1+에서 실행합니다. Git·Node.js·Neovim·Windows Terminal·선택한 AI CLI가 없으면 WinGet/npm으로 설치하고 PATH를 갱신합니다. 디자인·PPT 도구에 필요한 실제 Python도 확인해 설치합니다. WinGet이 없는 PC는 Windows 앱 설치 관리자를 먼저 설치해야 합니다.

[GitHub Releases](https://github.com/jjoonyna/AI-Settings/releases)에서 `AI-Settings-Setup-v0.0.3.exe`를 내려받아 실행하고 마법사에서 구성을 선택합니다. 완료 화면에서 사용설명서를 열 수 있으며 릴리즈에서 PDF를 별도로 내려받을 수도 있습니다. 업데이트할 때도 새 버전의 EXE를 다시 실행한 뒤 Neovim을 다시 엽니다.

대체 방법으로 **Source code (zip)**을 내려받아 압축을 풀고 `install.cmd`를 실행할 수 있습니다. EXE는 코드 서명되지 않았습니다.

Git으로 저장소를 받아 설치할 수도 있습니다.

```powershell
git clone https://github.com/jjoonyna/AI-Settings.git
.\AI-Settings\install.cmd
```

EXE에서는 마법사에서, ZIP 또는 Git의 `install.cmd`에서는 콘솔 메뉴에서 **Claude + Codex** 또는 **Codex만** 선택합니다. Neovim·공통 규칙·상태줄·디자인/PPT 스킬이 선택한 구성에 맞춰 자동 설치됩니다. 설정 배치에는 관리자 권한이나 symlink가 필요하지 않지만 필수 프로그램 설치는 설치 관리자가 권한을 요청할 수 있습니다. 다운로드에는 네트워크가 필요합니다.

설치 중 콘솔에 자세한 진행 내용이 표시됩니다. 실패하면 오류 코드와 로그 위치를 확인하고 EXE를 다시 실행하세요. `install.cmd`는 성공·실패 후 키 입력을 기다립니다. 설치 로그는 `~/.ai-settings/logs/install-<시각>.log`에 남습니다. Neovim을 연 것만으로 설정이 설치되지는 않습니다. 설치 후 새 터미널에서 `claude` 또는 `codex`를 실행해 로그인하고 Neovim을 다시 열어 일반 모드에서 Space → a → a를 누릅니다. Codex 전용 구성이면 Codex만 표시됩니다.

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

[한국어 사용설명서 PDF](runtime/AI-Settings-User-Guide.ko.pdf)에서 설치, 첫 세션, 검토, 문제 해결 절차를 볼 수 있습니다. 설치 후 기본 위치는 `%USERPROFILE%\.ai-settings\AI-Settings-User-Guide.ko.pdf`입니다.

`<leader>aa` / `:Agent`에서 새 세션, 선택 재개, 최근 재개를 고릅니다. `<leader>ar` / `:AgentResume`은 선택 재개, `<leader>ac` / `:AgentContinue`는 최근 재개입니다. `<leader>an` / `:AgentNew`에서도 같은 방식을 선택합니다. 선택 재개는 현재 폴더의 저장 세션을 Neovim에서 고른 뒤 정확한 ID로 CLI를 열며, 취소하면 세션을 만들지 않습니다. 확인된 제목·역할·모델은 선택 직후 표시하고 활동 상태는 훅으로 갱신합니다. 최근 재개는 CLI의 최근 세션 기능을 사용합니다. 위임이나 작업 완료 시 확인할 수 없는 정보는 선택 후 요청을 다시 실행합니다.

계획 세션이 난이도 → 작업량 → 예상 사용량 순서로 작업 모델을 정해 위임합니다. 일반 실행은 Sonnet·Terra, 명확한 작은 작업은 Haiku·Luna를 우선 검토합니다. 동일 모델도 사용할 수 있으며 자동 배정 상한은 호출 모델입니다. 모델 목록과 등급은 `runtime/models.json`, 운영 정본은 `runtime/POLICY.md`입니다. 설치 후에는 같은 파일이 `~/.ai-settings`에 배치됩니다.

작업 결과는 별도 읽기 전용 리뷰를 거칩니다. Claude의 작업은 Claude에 맡기고, Codex 교차 리뷰는 Claude 5시간·주간 사용률 중 유효한 값 하나가 80% 이상일 때 허용합니다. Codex는 Codex만 호출합니다. 한도 정보가 없거나 2분 이상 오래되면 미확인으로 처리합니다.

창 제목과 저장된 세션 이름은 `역할 | 작업 제목`입니다. 상태줄은 모델과 5시간/주간 한도를 컨텍스트보다 먼저 표시하며 추론 수준·작업 위치·브랜치도 표시합니다. Codex는 내장 상태줄 표현을 사용하므로 한도가 잔여량으로 보일 수 있습니다. Claude는 사용률을 표시하며 계정에서 제공하지 않는 값은 `?`로 표시합니다. resume 이름은 초기 `/rename` 전달과 CLI 지원 여부에 따라 확인이 필요합니다.

Claude와 Codex 리뷰는 전체 승인으로 실행합니다. 리뷰 지시로 코드·문서·파일의 수정·생성·삭제를 금지하며 이 규칙은 셸과 외부 도구에도 적용합니다.

핸드오프·보고·검토는 설치된 `session-workflow` 스킬과 `bin/session.mjs`를 사용합니다. Neovim에서 AI를 호출하면 작업 공간이 열립니다. 작업 공간은 왼쪽부터 AI 목록·대화·문서 본문·문서 목록이며 문서가 없으면 2영역입니다. `Agent`·`AgentNew`로 연 대화는 현재 창의 왼쪽 목록에 쌓입니다. 다른 창의 세션은 `:AgentInstances`에서 연결합니다. AI를 바꿔도 숨긴 작업은 계속 실행됩니다. 검토 요청은 현재 대화 포커스를 유지합니다.

AI 목록은 세션 제목과 모델을, 문서 목록은 문서 제목과 소유 계획 제목을 연속된 두 줄로 표시합니다. 항목 사이 구분선은 선택되지 않으며 방향키로 건너뜁니다.

사용자는 `docs/user-review/<주제>.md` 본문에서 a로 승인·진행, r로 수정 요청합니다. Ctrl+D는 본문 숨김이고 `AgentDocument`·`AgentDocuments`로 다시 표시합니다. 좁은 화면에서는 목록을 숨기며 `AgentList`로 AI 목록을 열 수 있습니다. 승인 후에도 문서는 남고 개정되면 재검토합니다. 부모의 검증·별도 리뷰 확인을 담은 `session.mjs task-complete <JSON>`만 정확한 소유자·작업의 문서를 목록에서 제거하며 원본은 보존합니다. 앱 원격 preview 본문 출력과 기존 standalone 별도 창도 유지합니다. 일반 진행 갱신이나 완료 때 검토를 새로 요청하지 않습니다.

검토 본문은 읽기 전용 Markdown 뷰어로 표시합니다. 왼쪽 AI 목록은 각 세션 이름 앞의 원 하나로 활동 상태를 표시합니다. 같은 계획에서 연 작업·리뷰는 해당 계획 아래에 묶이며 현재 대화의 계획만 자동으로 펼칩니다. 화살표 클릭이나 Space로 접거나 펼치며 대화는 바뀌지 않습니다. 접힌 계획의 상태는 계획과 자식의 활동을 집계하고 선택한 세션은 배경으로 표시합니다. 선택한 항목에서 `?`를 누르면 정확한 상태를 확인할 수 있습니다. 양쪽 목록의 제목은 역할 구분자 주변 공백 없이 한 줄로 표시하며 창 너비를 넘으면 `...`으로 줄입니다. AI 활동은 CLI 지원 hooks로 작업 중·응답 요청·대기·완료·중단·오류·확인 불가를 구분합니다. Codex 새 hooks는 `/hooks`에서 검토·신뢰해야 실행될 수 있습니다. 자동 신뢰·승인하지 않습니다. 미지원/미수신 이벤트는 확인 불가이며 `session.mjs activity <상태>`로 명시할 수 있습니다. Claude 중단의 전용 이벤트는 확인하지 못했습니다. 일반 clean exit는 중단, 비정상 종료는 오류로 구분하고 완료·검토 대기는 보존합니다. 턴 종료·프로세스 종료·단순 보고는 작업 완료가 아닙니다.

프로젝트 내부 문서는 `/docs/` 전체와 생성된 루트 `AGENTS.md`·`CLAUDE.md`를 Git에서 제외합니다. README·CHANGELOG는 루트에 둡니다. `/agent-init`은 기존 문서를 조사해 이 구조를 준비합니다. 커밋·머지·push는 각각 사용자 명시 지시가 있을 때만 실행합니다.

## 외부 스킬

코드 작성은 Ponytail 스킬(full)로 최소 변경을 우선합니다. 리팩토링은 agent-rules-books의 Refactoring·Working Effectively with Legacy Code 스킬을 적용하고, 범위 밖 후보는 `docs/refactoring/<영역>.md`에 기록합니다. 디자인 요청에 맞춰 UI UX Pro Max·frontend-design·Impeccable을 선택해 활용합니다. PPT는 [PPT Master](https://github.com/hugohe3/ppt-master)를 사용합니다. 외부 소스는 `runtime/tool-sources.json`에 고정한 커밋으로 설치하고 원본 라이선스를 보존합니다. Impeccable 엔진은 첫 실행 시 추가 다운로드가 필요할 수 있습니다. Python 의존성은 `~/.ai-settings/python`의 별도 환경에 설치합니다.

## 제거와 복구

Source code ZIP을 내려받아 압축을 푼 폴더에서 실행합니다. EXE는 별도 제거기를 만들지 않습니다.

```powershell
.\uninstall.ps1
```

설치 당시의 원본으로 관리 항목을 복원합니다. 설치 후 수정된 일반 파일은 보존하고, JSON/TOML 설정에서는 관리 키만 되돌리며 개인 추가 항목은 유지합니다. 백업은 자동 삭제하지 않습니다. 이전 버전 매니페스트만 있는 환경에는 기존 제거 경로를 유지합니다.

## 검증

```powershell
node --test tests/runtime.test.mjs
node --test tests/session-events.test.mjs
$env:XDG_CONFIG_HOME = (Get-Location).Path
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/policy.lua
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/integration.lua
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/handoff-send.lua
nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/workspace.lua
```

추가 PowerShell 테스트는 Pester 5로 실행합니다. 실제 로그인 계정의 사용률 제공 여부, CLI의 초기 이름 저장·resume, Windows Terminal 검토 창은 로그인한 데스크톱 환경에서 확인해야 합니다.


### Codex 앱 원격 세션

Neovim 없이 Codex 앱 계획 대화에서 `session.mjs handoff <요청.json>`으로 별도 작업·리뷰 대화를 시작합니다. 정확한 부모 ID와 실제 모델·계획 역할, 문서와 모델 상한을 검증하고 서버 응답의 샌드박스와 승인 설정이 맞을 때 작업을 시작합니다. 반환된 대화 ID와 turn ID로 `session.mjs status <대화 ID> <turn ID>` 또는 `result <대화 ID> <turn ID>`를 실행해 해당 작업의 상태와 보고를 확인합니다. 앱 자식은 최종 응답으로 보고하고 부모가 직접 읽습니다. `preview <문서>`는 검토 본문을 출력하며 표시는 승인이 아닙니다. 요청 형식은 설치된 `session-workflow` 스킬을 따릅니다.

turn ID는 조회 시 생략할 수 있지만 완료를 확정하려면 handoff가 반환한 turn ID가 최신 turn과 일치해야 합니다. 앱 리뷰는 전체 승인으로 시작하고 코드·문서·파일의 수정 금지를 지시합니다. 리뷰는 실제 원문을 읽고 근거를 보고합니다.

### 공통 스킬과 세션

Codex와 Claude Code는 동일 고정 Superpowers 스킬과 단계별 선택 기준을 사용합니다. 승인된 계획을 받은 작업 세션은 설계 승인을 반복하지 않으며, 계획 세션은 로컬과 원격에서 별도 작업·읽기 전용 리뷰 세션을 엽니다. 사용자 지시와 공통 운영 규칙이 외부 스킬 지침보다 우선합니다. 스킬 목록 갱신에는 새 대화가 필요할 수 있습니다.
