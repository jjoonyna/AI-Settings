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

Space a l 또는 :AgentList로 연다. 같은 Windows 사용자 계정과 같은 설정을 쓰는 Neovim들이 목록을 공유한다.

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

Space a n 또는 :AgentNew로 새 유지 세션을 만든다. 에이전트·계획/작업 종류·폴더·작업 이름을 선택하면 백그라운드 Neovim과 별도 화면이 열린다.

- Windows Terminal 창 닫기 또는 :AgentDetach: 화면 연결만 끊고 작업을 유지한다.
- 다시 :AgentList에서 선택: 같은 서버와 터미널에 재접속한다.
- 작업 목록의 Shift+x: 대상 세션에 속한 모든 작업 이름을 확인한 후 실제 종료한다. 저장하지 않은 버퍼가 있으면 종료하지 않는다.
- :q/:qa는 Neovim 자체 종료 명령이다. 화면만 닫을 때는 :AgentDetach를 사용한다.
- 재부팅·로그아웃·프로세스 충돌까지 실행 상태가 보존되지는 않는다.

기존 Space a a / :Agent는 현재 Neovim 안에 에이전트를 연다. 일반 방식으로 이미 실행한 Neovim과 에이전트는 자동으로 유지 세션으로 변환되지 않는다. 기존 창의 프로세스는 그대로 둔다.

수동으로 열린 일반 Neovim은 원격으로 해당 터미널을 선택한 뒤 Windows 창을 직접 전환해야 할 수 있다. 새 유지 세션은 Windows Terminal 창 이름으로 화면 전환을 연결한다.

## 작업 기록 공유

공통 기록은 stdpath('state')/agent-hub 아래에 있다.

- instances/: 실행 중인 Neovim별 등록 정보.
- tasks/<작업 식별자>/: 작업 설명과 에이전트별 Markdown 기록.
- requests/: 새 세션 실행 요청과 시작 결과.
- previews/: 계획 문서의 최초 표시 여부.

같은 작업에 참여하려면 목록에서 a를 사용한다. 새 에이전트 시작 지시에 공유 폴더·자기 기록·설계 경로를 포함한다. 각 에이전트는 자기 파일에만 진행 상황을 쓰고 다른 참여자의 기록을 읽는다. 기존 .agent-shared.md는 작업 설명에서 참고 경로로 제공한다.

전체 대화와 모델의 기억은 자동으로 합쳐지지 않는다. 기록이 바뀌었다고 진행 중인 에이전트의 대화에 자동 삽입되지는 않는다. 기존에 실행 중이던 에이전트에는 새 공유 규칙이 소급 주입되지 않는다.

## 계획 문서 검토 창

등록된 작업 폴더와 Neovim 설정 폴더의 docs/superpowers/plans/에 새 Markdown 파일이 생기면, 저장이 잠시 안정된 뒤 별도 Windows Terminal 창을 최대화해 보여준다. 최초 확인만 자동으로 하며 기존 문서를 시작 시 일괄 열지 않는다.

- 검토 창은 Catppuccin Mocha를 사용하는 읽기 전용 Neovim이다.
- 검토 창의 Ctrl+d는 그 창만 종료한다. 에이전트 작업에는 영향이 없다.
- :AgentPlanPreview <절대 경로>로 언제든 다시 열 수 있다.
- 감시 범위 밖에 만든 계획은 위 명령으로 연다.

## 에이전트용 호출

Neovim Lua에서 다음 함수를 호출할 수 있다. 외부 프로세스는 자신의 NVIM 파이프에 --headless --server로 연결해 v:lua 함수를 호출한다.

```lua
AgentHubNew({
  agent = 'claude', -- 또는 'codex'
  session = 'plan', -- 또는 'work'
  cwd = 'C:/ExRBM/rbm',
  name = '작업 이름',
  task_id = '기존 작업 식별자', -- 새 작업이면 생략
  plan_doc = '설계 또는 계획의 절대 경로',
  prompt = '수행할 작업과 범위',
})
AgentHubStatus()
AgentPlanPreview('계획 문서의 절대 경로')
```

AgentHubNew는 시작 요청 식별자를 반환한다. 실제 시작 실패는 알림과 requests/<식별자>.json.result에서 확인한다. 같은 request_id를 재사용하면 중복으로 실행하지 않는다. 새 창 생성 자체는 worktree를 만들지 않는다.

## 설정과 검증

구현은 lua/config/agent/{hub,bridge,launcher,panel,plan_preview}.lua와 scripts/agent-hub-*.lua, scripts/agent-hub-launch.ps1에 있다. 현재 프로세스에 적용하는 agent-hub-apply.lua는 기존 registry를 유지한다.

격리 검증:

```powershell
nvim --headless -u NONE -i NONE -l "$env:LOCALAPPDATA/nvim/tests/agent-hub/integration.lua"
nvim --headless -u NONE -i NONE -l "$env:LOCALAPPDATA/nvim/tests/agent-hub/ui-integration.lua"
```

두 번째 검증은 테스트용 실제 창을 잠시 열고 닫는다. 실제 AI CLI는 실행하지 않는다. 변경 전 설정 사본은 backups/2026-09-15-agent-hub/에 있다.
