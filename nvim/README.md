# Neovim 개인 작업 환경

Catppuccin Mocha 테마와 여러 에이전트를 관리하는 공통 작업 목록을 사용한다.

## 입력과 창 이동

| 키 | 동작 |
|---|---|
| Ctrl+w | 일반 모드에서 문서 입력 또는 터미널 입력으로 진입 |
| Ctrl+q | 문서·터미널 입력에서 일반 모드로 돌아오기 |
| Alt+h/j/k/l | 왼쪽·아래·위·오른쪽 창으로 이동 |

Markdown의 영어 맞춤법 표시와 markdownlint 형식 검사는 끈다. Marksman 링크 검사와 Prettier 정렬은 유지한다.

## 작업 목록

Space a l 또는 :AgentList로 AI 작업 공간을 연다. 왼쪽부터 AI 목록·대화, 검토 요청이 있으면 문서 본문·문서 목록을 더해 4영역이다. AI와 문서 선택은 독립적이며 Enter 또는 마우스 클릭으로 선택한다. AI 항목은 이름·모델·상태를 별도 줄로 표시한다. `?`로 도움말을 본다. 자동 갱신·검토 요청은 현재 대화 입력 포커스를 유지한다.

새 계획·작업·리뷰는 같은 서버의 터미널을 사용하며 선택을 바꿔도 다른 job과 버퍼는 유지한다. 일반 편집 탭은 별도로 보존한다. 좁은 화면에서는 문서 목록, 본문, AI 목록을 차례로 숨기며 `AgentDocuments`·`AgentDocument`·`AgentList`로 필요한 영역을 표시한다. Alt+h/l로 영역을 이동하고 Ctrl+w/q 입력 전환은 기존과 같다.

기존 외부 Neovim의 관리·이름·공유 기록·종료는 `:AgentInstances` 또는 AI 목록의 I로 연다. 외부 프로세스 터미널을 현재 서버로 이동하지 않으며 기존 attach를 사용한다. 아래 키는 외부 관리 목록 기준이다.

| 키 | 동작 |
|---|---|
| j/k 또는 방향키 | 작업 선택 |
| Enter | 선택한 에이전트로 이동·화면 재연결 |
| r | 작업 이름 변경 |
| s | 공유 기록 선택·열기 |
| a | 같은 작업의 기록을 공유하는 새 에이전트 세션 열기 |
| n | 독립된 새 유지 세션 열기 |
| R | 새로고침 |
| Shift+x | 선택한 Neovim 세션과 그 안의 모든 작업 종료 확인 |
| q 또는 Esc | 목록만 닫기 |

목록에는 작업 이름, 에이전트, 창 식별자, 실행 시 브랜치, 작업 폴더를 표시한다. 약 5초 간격으로 갱신하며 응답하지 않는 세션은 연결 확인 필요로 표시한다. 실행 시 브랜치는 실시간 Git 상태가 아니다.

## 창을 닫아도 작업 유지

`<leader>aa` / `:Agent`에서 새 세션, 선택 재개, 최근 재개를 고른다. `<leader>ar` / `:AgentResume`은 선택 재개, `<leader>ac` / `:AgentContinue`는 최근 재개다. `<leader>an` / `:AgentNew`도 통합 작업 공간에서 같은 서버에 생성한다. 재개는 CLI 선택기 또는 최근 세션을 사용하며 모델·제목을 묻거나 저장 이름을 바꾸지 않는다. 세션 시작 훅이 선택한 CLI ID의 저장 이름·모델·역할을 복구한다. 재개 후 위임·작업 완료 시에도 확인하며, 정보가 없으면 선택 후 다시 요청한다.

- 기존 managed 서버의 Windows Terminal 창 닫기 또는 :AgentDetach는 화면 연결만 끊고 작업을 유지한다. 일반 Neovim 서버를 종료하면 그 안의 작업도 종료되므로 통합 작업 공간에서는 job을 유지한 채 다른 AI를 선택하거나 편집 탭으로 전환한다.
- 다시 :AgentList에서 선택: 같은 서버와 터미널에 재접속한다.
- 작업 목록의 Shift+x: 대상 세션에 속한 모든 작업 이름을 확인한 후 실제 종료한다. 저장하지 않은 버퍼가 있으면 종료하지 않는다.
- :q/:qa는 Neovim 자체 종료 명령이다. 화면만 닫을 때는 :AgentDetach를 사용한다.
- 재부팅·로그아웃·프로세스 충돌까지 실행 상태가 보존되지는 않는다.

일반 방식으로 이미 실행한 Neovim과 에이전트는 자동으로 유지 서버로 변환되지 않는다. 기존 창의 프로세스는 그대로 둔다. API의 `separate_server=true`와 테스트용 `no_ui=true`는 기존 별도 서버 경로를 유지한다.

수동으로 열린 일반 Neovim은 원격으로 해당 터미널을 선택한 뒤 Windows 창을 직접 전환해야 할 수 있다. 새 유지 세션은 Windows Terminal 창 이름으로 화면 전환을 연결한다.

## 작업 기록 공유

공통 기록은 stdpath('state')/agent-hub 아래에 있다.

- instances/: 실행 중인 Neovim별 등록 정보.
- tasks/<작업 식별자>/: 작업 설명과 에이전트별 Markdown 기록.
- requests/: 새 세션 실행 요청과 시작 결과.
- reviews/<인스턴스>.json: 소유 세션·작업에 연결한 검토 요청·결정·문서 fingerprint. 원자 저장하며 손상 시 오류를 표시한다.

같은 작업에 참여하려면 목록에서 a를 사용한다. 새 에이전트 시작 지시에 공유 폴더·자기 기록·설계 경로를 포함한다. 각 에이전트는 자기 파일에만 진행 상황을 쓰고 다른 참여자의 기록을 읽는다. 기존 .agent-shared.md는 작업 설명에서 참고 경로로 제공한다.

전체 대화와 모델의 기억은 자동으로 합쳐지지 않는다. 기록이 바뀌었다고 진행 중인 에이전트의 대화에 자동 삽입되지는 않는다. 기존에 실행 중이던 에이전트에는 새 공유 규칙이 소급 주입되지 않는다.

## 사용자 검토 문서

`docs/user-review/*.md`의 명시적 preview 요청만 등록한다. 파일 생성·열기·저장·창 닫기는 승인이나 완료가 아니다. CLI `session.mjs preview <문서>`는 현재 owner·task_id를 전달하며 `{path, owner, task_id}` JSON 파일도 받는다. 기존 Lua path 호출은 소유자가 하나일 때 호환된다. 소유자·작업이 모호하거나 불일치하면 거부한다.

- 통합 화면의 본문은 읽기 전용이며 a는 승인·진행, r은 수정 요청을 해당 AI에 전달한다. 승인 후에도 목록을 유지하고 개정되면 재검토한다.
- Ctrl+D는 본문 숨김이며 `AgentDocument`로 복원한다. 숨겨도 문서와 작업은 남는다.
- 부모가 검증·별도 리뷰를 확인한 뒤 `AgentTaskComplete({owner=자식번호, task_id='정확한 ID', parent_id=부모번호, verified=true, reviewed=true})` 또는 같은 JSON의 `session.mjs task-complete`를 호출한다. 미승인·개정·수정 요청 문서는 거부한다. 해당 소유자/작업 문서만 목록에서 제거하고 원본은 보존한다.
- 기존 standalone은 별도 읽기 전용 검토 창과 Ctrl+D 닫기를 유지한다. 앱 원격 preview는 본문을 stdout에 표시한다.

## CLI 상태

설치된 Claude 2.1.185 바이너리의 hook enum과 Codex 0.154.0/0.166.0 버전 스키마에서 확인한 공통 SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·PermissionRequest·Stop·SessionEnd를 사용한다. Claude는 Notification·PostToolUseFailure·StopFailure, Codex는 Interrupt를 추가한다. [Claude hooks](https://code.claude.com/docs/en/hooks), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex 0.154 스키마](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/config.schema.json)를 참고한다.

직접 CLI 프롬프트·도구 실행은 작업 중, 권한/질문 요청은 응답 요청, Stop·idle_prompt는 대기다. 검토 대기와 실제 실행 근거는 별도 보관하며 표시한다. Stop·프로세스 종료는 완료가 아니다. 명시적 부모 완료 후 새 UserPromptSubmit은 작업 중으로 전환한다. 인스턴스·소유자·실행별 token·CLI 세션·시각과 가능한 turn ID로 오래되거나 다른 실행 이벤트를 거부한다.

개인 hooks·notify를 보존하고 Codex hook 신뢰를 자동 설정하지 않는다. 새 hooks는 `/hooks`에서 사용자가 검토·신뢰해야 실행될 수 있다. 수신되지 않은 상태는 확인 불가다. Claude 중단의 전용 이벤트는 이번 어댑터에서 확인하지 못했으며 `session.mjs activity working|idle|response_requested|interrupted|error|unknown`으로 명시한다. 일반 clean exit는 중단, 비정상 종료는 오류이며 완료·검토 대기는 보존하고 종료 코드로 실행 생존 상태를 구분한다. 비활동 시간을 중단 근거로 삼지 않는다. 실제 로그인 CLI의 전체 이벤트/사용자 hook 신뢰 흐름은 격리 테스트와 구분해 확인해야 한다.

## 에이전트용 호출

Neovim Lua에서 다음 함수를 호출할 수 있다. 외부 프로세스는 자신의 NVIM 파이프에 --headless --server로 연결해 v:lua 함수를 호출한다.

```lua
AgentHubNew({
  agent = 'claude', -- 또는 'codex'
  session = 'plan', -- 작업·리뷰는 AgentHandoff 사용
  cwd = 'C:/ExRBM/rbm',
  name = '작업 이름',
  task_id = '기존 작업 식별자', -- 새 작업이면 생략
  plan_doc = '설계 또는 계획의 절대 경로',
  prompt = '수행할 작업과 범위',
})
AgentHubStatus()
AgentPlanPreview({path='프로젝트/docs/user-review/주제.md', owner=세션번호, task_id='정확한 작업 ID'})
```

AgentHubNew는 시작 요청 식별자를 반환한다. 실제 시작 실패는 알림과 requests/<식별자>.json.result에서 확인한다. 같은 request_id를 재사용하면 중복으로 실행하지 않는다. 새 창 생성 자체는 worktree를 만들지 않는다.

## 설정과 검증

구현은 lua/config/agent/{hub,bridge,launcher,panel,workspace,reviews,activity,plan_preview}.lua와 scripts/agent-hub-*.lua, scripts/agent-hub-launch.ps1, runtime session-events.mjs에 있다. 현재 프로세스에 적용하는 agent-hub-apply.lua는 기존 registry를 유지한다. 새 event token은 새로 생성한 세션에만 전달되므로 기존 CLI는 명시 상태 연동을 위해 재시작이 필요할 수 있다.

격리 검증:

```powershell
nvim --headless -u NONE -i NONE -l "$env:LOCALAPPDATA/nvim/tests/agent-hub/integration.lua"
nvim --headless -u NONE -i NONE -l "$env:LOCALAPPDATA/nvim/tests/agent-hub/workspace.lua"
& <설치된 Python 경로> "$env:LOCALAPPDATA/nvim/tests/agent-hub/ui-workspace.py"
nvim --headless -u NONE -i NONE -l "$env:LOCALAPPDATA/nvim/tests/agent-hub/ui-integration.lua"
```

두 번째 검증은 테스트용 실제 창을 잠시 열고 닫는다. 실제 AI CLI는 실행하지 않는다. 변경 전 설정 사본은 backups/2026-09-15-agent-hub/에 있다.
