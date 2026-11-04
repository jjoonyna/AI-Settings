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
```

handoff JSON에는 아래 Lua 예시와 같은 키를 사용한다. 런처가 Base64와 구조화된 인자로 전달하므로 주제·경로의 따옴표를 셸 코드에 직접 삽입하지 않는다. 다음은 Neovim 내부 Lua API 예시이며 `--remote-expr`에 Lua 테이블을 그대로 전달하지 않는다.

```lua
AgentHandoff({agent='claude', session='work', model='sonnet', parent_model='opus', parent_agent='claude', parent_id=1, name='작업 주제 · 담당 범위', plan_doc='실제 절대 경로', spec_doc='실제 절대 경로', goal='목표', scope='담당 범위', decisions='확정 결정', validation='완료·검증 기준', report_to='부모 서버와 세션 ID', prompt='핵심 작업 지시'})
```

- `session='review'`는 읽기 전용으로 실행한다. 교차 Codex 리뷰에는 `parent_agent='claude'`와 실제 부모 모델을 전달한다. 도구가 사용률 캐시를 검증한다.
- Neovim 리뷰 세션은 파일 쓰기가 금지되므로 보고를 `report -`(stdin heredoc)로 전송하고 출력의 OK를 확인한다. Claude 리뷰는 수정 도구만 차단하고 git 읽기 명령·보고 명령·WebFetch는 허용하며 그 밖의 Bash는 사용자 확인을 거친다. handoff JSON의 선택 키 `verify_cmds`(문자열 배열, 예: `["node --test"]`)로 지정한 검증 명령은 리뷰 세션에서 확인 없이 허용된다. PowerShell에서 `report -`로 파이프할 때는 먼저 `$OutputEncoding = [Text.UTF8Encoding]::new($false)`를 설정한다(미설정 시 한글이 `?`로 깨지며 session.mjs가 거부한다). Codex 리뷰는 read-only 샌드박스를 유지하며 테스트·보고 명령이 막히면 권한 상승을 요청한다. 리뷰 명령은 작업 폴더에서 바로 실행하고 cd … &&를 붙이지 않는다. 임시 파일을 만들지 않는다. 허용 목록 밖 명령이 필요하면 실행하지 말고 보고에 적는다.
- 에이전트 도구에 모델 지정이 지원되면 같은 등급 정책으로 명시한다. 지원되지 않는 모델 지정으로 실행하지 말고 지원되는 세션 위임 경로를 사용한다.
- Neovim 결과 보고: `AgentReport({parent_server='...', parent_id=숫자, text='완료 범위 / 검증 결과 / 미해결 / 다음 판단'})`. 수신 실패 시 다시 보고하며 전송 성공 전 완료 종료하지 않는다.
- Neovim 사용자 검토 표시: `v:lua.AgentPlanPreview('프로젝트/docs/user-review/주제.md')`. 단순 상태 갱신·완료 시 자동 호출 금지. 창 닫기는 승인 아님.
- Neovim 세션 이름: `/rename 역할 | 작업 제목`. 초기 명명은 런처가 전달하며 재개 후 역할·주제가 바뀌면 갱신한다.


## Codex 앱 원격

NVIM이 없으면 정확한 `CODEX_THREAD_ID` 또는 `CODEX_SESSION_ID`와 실제 계획 역할·모델을 검증해 Codex 앱의 별도 영구 대화를 생성한다. JSON의 `agent`는 `codex`, `session`은 `work` 또는 `review`, `model`은 실제 부모 이하로 지정한다. `name`, `goal`, `scope`, `validation`, `prompt`, `spec_doc`, `plan_doc`와 작업 경로를 제공한다. 작업은 workspace-write, 리뷰는 read-only이며 실제 응답을 검증한 뒤 시작한다. 상위 도구 제한이 우선한다.

새 앱 계획 대화는 첫 질문으로 임의 제목이 붙을 수 있다. 사용자가 계획 역할로 연 대화는 위임 전에 현재 대화의 이름을 `계획 | 작업 제목`으로 지정한다. 작업·리뷰는 자기 역할을 계획으로 바꿔 재위임하지 않는다. 상위 도구 제한으로 앱 도구에 모델을 지정할 수 없으면 모델 지정을 지원하는 CLI 경로를 사용한다.

handoff가 반환한 `threadId`와 `turnId`를 보관하고 `node <설치루트>/bin/session.mjs status <대화 ID> <turn ID>` 또는 `result <대화 ID> <turn ID>`로 실제 서버 상태와 해당 최신 turn의 최종 응답을 확인한다. 서버마다 상태가 다를 수 있으므로 앱 read/wait 결과만으로 완료를 판정하지 말고 이 turn ID 기준 조회를 사용한다. ID가 다르거나 active·failed·interrupted·unknown이면 완료가 아니다. turn ID를 생략해도 조회와 본문 확인은 가능하지만 서버 상태와 무관하게 완료 확정에는 handoff turn ID의 일치가 필요하다. 앱 자식은 `report` 대신 최종 응답으로 완료 범위·변경 파일·검증 명령과 결과·미해결·다음 판단을 보고한다. 부모는 직접 회수하고 확인 전 대화를 삭제하거나 보관하지 않는다. 앱 preview는 문서 본문을 stdout에 출력하므로 부모가 본문과 링크를 대화에 표시하며 승인이 아니다.

앱 리뷰는 read-only sandbox를 요청하고 프롬프트에 코드·문서·파일 수정 금지를 명시한다. D: exFAT에서는 OS 수준 쓰기 차단이 적용되지 않으므로 이 지시를 운영 규칙으로 따른다. 리뷰 에이전트는 실제 원문을 읽고 요구·diff·검증 근거를 보고하며 파일을 수정하지 않는다.
