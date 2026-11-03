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
```

handoff JSON에는 아래 Lua 예시와 같은 키를 사용한다. 런처가 Base64와 구조화된 인자로 전달하므로 주제·경로의 따옴표를 셸 코드에 직접 삽입하지 않는다. 다음은 Neovim 내부 Lua API 예시이며 `--remote-expr`에 Lua 테이블을 그대로 전달하지 않는다.

```lua
AgentHandoff({agent='claude', session='work', model='sonnet', parent_model='opus', parent_agent='claude', parent_id=1, name='작업 주제 · 담당 범위', plan_doc='실제 절대 경로', spec_doc='실제 절대 경로', goal='목표', scope='담당 범위', decisions='확정 결정', validation='완료·검증 기준', report_to='부모 서버와 세션 ID', prompt='핵심 작업 지시'})
```

- `session='review'`는 읽기 전용으로 실행한다. 교차 Codex 리뷰에는 `parent_agent='claude'`와 실제 부모 모델을 전달한다. 도구가 사용률 캐시를 검증한다.
- 에이전트 도구에 모델 지정이 지원되면 같은 등급 정책으로 명시한다. 지원되지 않는 모델 지정으로 실행하지 말고 지원되는 세션 위임 경로를 사용한다.
- 결과 보고: `AgentReport({parent_server='...', parent_id=숫자, text='완료 범위 / 검증 결과 / 미해결 / 다음 판단'})`. 수신 실패 시 다시 보고하며 전송 성공 전 완료 종료하지 않는다.
- 사용자 검토 표시: `v:lua.AgentPlanPreview('프로젝트/docs/user-review/주제.md')`. 단순 상태 갱신·완료 시 자동 호출 금지. 창 닫기는 승인 아님.
- 세션 이름: `/rename 역할 | 작업 제목`. 초기 명명은 런처가 전달하며 재개 후 역할·주제가 바뀌면 갱신한다.
