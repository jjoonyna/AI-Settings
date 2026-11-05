---
name: session-workflow
description: 계획·작업·읽기 전용 리뷰를 연결하고 모델 선택, 인계, 사용자 검토 문서를 관리한다.
---

# 세션 실행

설치된 `~/.ai-settings/POLICY.md`와 `models.json`을 따른다. 사용자 홈은 실제 환경에서 찾는다. `~/.ai-settings/install.json`에서 설치 모드를 확인한다.

설치된 `~/.ai-settings/bin/session.mjs`를 Node로 실행한다. 실제 설치 루트는 환경변수 `AI_SETTINGS_HOME`을 우선 사용한다. 구조화된 JSON 요청 파일을 프로젝트 `docs/` 아래에 쓰고 다음처럼 전달한다. 명령 경로는 실제 절대경로로 확장한다.

```text
node <설치루트>/bin/session.mjs handoff <요청.json>
node <설치루트>/bin/session.mjs preview <프로젝트>/docs/user-review/<주제>.md
node <설치루트>/bin/session.mjs report <결과.md>
node <설치루트>/bin/session.mjs report -   # 본문을 표준 입력(heredoc)으로 전달
node <설치루트>/bin/session.mjs task-complete <완료확인.json>
node <설치루트>/bin/session.mjs activity working|idle|response_requested|interrupted|error|unknown
```

handoff JSON에는 아래 Lua 예시와 같은 키를 사용한다. 런처가 Base64와 구조화된 인자로 전달하므로 주제·경로의 따옴표를 셸 코드에 직접 삽입하지 않는다. 다음은 Neovim 내부 Lua API 예시이며 `--remote-expr`에 Lua 테이블을 그대로 전달하지 않는다.

```lua
AgentHandoff({agent='claude', session='work', model='sonnet', parent_model='opus', parent_agent='claude', parent_id=1, name='작업 주제 · 담당 범위', plan_doc='실제 절대 경로', spec_doc='실제 절대 경로', goal='목표', scope='담당 범위', decisions='확정 결정', validation='완료·검증 기준', report_to='부모 서버와 세션 ID', prompt='핵심 작업 지시'})
```

- `session='review'`는 읽기 전용으로 실행한다. 교차 Codex 리뷰에는 `parent_agent='claude'`와 실제 부모 모델을 전달한다. 도구가 사용률 캐시를 검증한다.
- Claude와 Codex 리뷰는 전체 승인으로 실행한다. 파일 수정·생성·삭제와 재위임을 금지하며 셸·외부 도구에도 적용한다. Neovim 보고는 report -로 보내고 OK를 확인한다. PowerShell에서는 먼저 $OutputEncoding = [Text.UTF8Encoding]::new($false) 를 설정한다.
- 에이전트 도구에 모델 지정이 지원되면 같은 등급 정책으로 명시한다. 지원되지 않는 모델 지정으로 실행하지 말고 지원되는 세션 위임 경로를 사용한다.
- Neovim 결과 보고: `AgentReport({parent_server='...', parent_id=숫자, text='완료 범위 / 검증 결과 / 미해결 / 다음 판단'})`. 수신 실패 시 다시 보고하며 전송 성공 전 완료 종료하지 않는다.
- Neovim 사용자 검토 표시: `AgentPlanPreview({path='프로젝트/docs/user-review/주제.md', owner=세션번호, task_id='작업 ID'})`. 기존 path 호출은 소유자가 유일하면 호환된다. CLI preview는 현재 세션·작업 ID를 전달하며 JSON 요청 파일도 받는다. 통합 화면은 현재 입력 포커스를 유지한 채 오른쪽에 표시한다. 단순 상태 갱신·완료 시 자동 호출 금지. 닫기는 승인 아님.
- 승인·수정 요청 후에도 검토 문서를 유지한다. 부모 검증과 별도 리뷰 후 `AgentTaskComplete({owner=자식번호, task_id='정확한 작업 ID', parent_id=부모번호, verified=true, reviewed=true})` 또는 같은 JSON의 `task-complete`로 해당 소유자의 문서만 목록에서 제거한다. 원본은 보존한다. 미승인·개정·수정 요청 중인 문서는 완료 확인을 거부한다. 보고/CLI Stop/프로세스 종료는 작업 완료가 아니다. 이 확인을 마친 뒤 필요하면 기존 AgentDone으로 자식을 닫는다. 재개 부모는 task-complete에서도 정확한 저장 세션의 역할·모델을 확인한다. 미확인은 기존 선택 UI에서 확인 후 재시도하며, 확인된 plan만 완료할 수 있다. work/review 또는 미확인 역할을 plan으로 가정하지 않는다.
- CLI hooks는 실제 지원 이벤트만 상태로 전달하며 개인 hooks·notify는 보존한다. Codex는 `/hooks`에서 새 정의를 검토·신뢰하기 전 실행되지 않을 수 있다. 신뢰를 자동 설정하지 않는다. 미수신·미지원 상태는 확인 불가이며 `activity`로 현재 세션 상태를 명시할 수 있다. Claude StopFailure는 오류로 전달하며 Claude 중단에는 이번 어댑터에서 검증한 전용 이벤트가 없어 수동 상태가 필요하다. 알림/로그 출력의 무응답 시간을 중단으로 추정하지 않는다.
- Neovim 세션 이름: `/rename 역할 | 작업 제목`. 초기 명명은 런처가 전달하며 재개 후 역할·주제가 바뀌면 갱신한다.


## Codex 앱 원격

NVIM이 없으면 정확한 `CODEX_THREAD_ID` 또는 `CODEX_SESSION_ID`와 실제 계획 역할·모델을 검증해 Codex 앱의 별도 영구 대화를 생성한다. JSON의 `agent`는 `codex`, `session`은 `work` 또는 `review`, `model`은 실제 부모 이하로 지정한다. `name`, `goal`, `scope`, `validation`, `prompt`, `spec_doc`, `plan_doc`와 작업 경로를 제공한다. 작업은 workspace-write, 리뷰는 전체 승인이며 실제 응답을 검증한 뒤 시작한다. 상위 도구 제한이 우선한다.

새 앱 계획 대화는 첫 질문으로 임의 제목이 붙을 수 있다. 사용자가 계획 역할로 연 대화는 위임 전에 현재 대화의 이름을 `계획 | 작업 제목`으로 지정한다. 작업·리뷰는 자기 역할을 계획으로 바꿔 재위임하지 않는다. 상위 도구 제한으로 앱 도구에 모델을 지정할 수 없으면 모델 지정을 지원하는 CLI 경로를 사용한다.

handoff가 반환한 `threadId`와 `turnId`를 보관하고 `node <설치루트>/bin/session.mjs status <대화 ID> <turn ID>` 또는 `result <대화 ID> <turn ID>`로 실제 서버 상태와 해당 최신 turn의 최종 응답을 확인한다. 서버마다 상태가 다를 수 있으므로 앱 read/wait 결과만으로 완료를 판정하지 말고 이 turn ID 기준 조회를 사용한다. ID가 다르거나 active·failed·interrupted·unknown이면 완료가 아니다. turn ID를 생략해도 조회와 본문 확인은 가능하지만 서버 상태와 무관하게 완료 확정에는 handoff turn ID의 일치가 필요하다. 앱 자식은 `report` 대신 최종 응답으로 완료 범위·변경 파일·검증 명령과 결과·미해결·다음 판단을 보고한다. 부모는 직접 회수하고 확인 전 대화를 삭제하거나 보관하지 않는다. 앱 preview는 문서 본문을 stdout에 출력하므로 부모가 본문과 링크를 대화에 표시하며 승인이 아니다.

앱 리뷰는 전체 승인으로 시작하고 프롬프트에 코드·문서·파일 수정 금지를 명시한다. D: exFAT와 같은 방식으로 이 지시를 운영 규칙으로 따른다. 리뷰 에이전트는 실제 원문을 읽고 요구·diff·검증 근거를 보고하며 파일을 수정하지 않는다.
