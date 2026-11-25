# Codex 사용 안내

관리 본문은 0.172.0 이상의 정확한 UUID queue API(검증 버전보다 높으면 시작 시 경고, 미만이면 시작 거부)로 전달합니다. 초기 지시는 준비 후 한 번만 등록하며 사용자 작성 중 입력에 본문·자동 Enter를 보내지 않습니다. 접수는 모델 실행·부모 확인과 다르며 unknown은 자동 재전송하지 않습니다. 이름은 metadata API로 바꾸고 TUI 자동 종료 미지원은 명시 실패해 세션을 보존합니다. exFAT에서는 역할별 설정이 OS 쓰기 차단을 보장하지 않으므로 기존 파일 수정 금지 운영 규칙과 MCP 경계를 유지합니다.

기본 계획 모델은 GPT-6.1 Sol입니다. Neovim 메뉴에서 모델과 작업 주제를 선택하세요. 작업·리뷰는 계획 세션이 모델을 지정해 엽니다. 프로필은 역할별 권한만 정의하며 모델은 고정하지 않습니다.

Codex·Claude/Neovim은 설치가 자동 등록하는 `ai_settings_sessions` 로컬 STDIO MCP를 우선 사용합니다. `connection_status`로 실제 세션·역할·모델을 확인하고, 계획은 `handoff`·`preview`·`task_complete`, 작업·리뷰는 `report`와 자기 `session_status`를 사용합니다. 계획은 정확한 직접 자식의 상태와 최신 보고도 조회할 수 있습니다. 문서는 현재 프로젝트 docs 내부 실제 Markdown만 전달합니다. 이 도구는 호스트에서 제한된 세션 관리만 실행하며 일반 셸·Lua·파일 쓰기를 제공하지 않습니다. 관리 시작·선택/최근 재개는 전용 private native 서버와 동일 UUID의 `--remote` TUI를 연결하며 실제 역할·모델·권한 응답을 확인합니다. 설치 후 새 세션에서 도구 발견·호출을 확인하세요. MCP 미등록·초기화·신원 실패와 샌드박스 CLI의 EPERM을 구분하며, identity/role/path 거부를 CLI로 우회하지 않습니다. 지원되지 않는 CLI·앱는 기존 `session.mjs`를 유지합니다.

공통 규칙은 설치된 `~/.ai-settings/POLICY.md`, 모델 목록은 `models.json`을 따릅니다. `/statusline`에서 표시 항목을 확인하고 `/rename 역할 | 작업 제목`으로 저장 이름을 갱신할 수 있습니다. 내부 문서는 `/docs/` 아래 로컬로 유지하고 README·CHANGELOG는 루트에서 공유합니다.

새 검토안은 `docs/<주제>.md`, spec과 plan은 `docs/superpowers/specs/`와 `docs/superpowers/plans/`에 둡니다. 작업별 임시·공유 자료는 각각 `docs/tmp/<작업>/`과 `docs/shared/<작업>/`에 둡니다. 기존 검토 경로도 사용할 수 있습니다. 계획 세션의 내부 에이전트는 조사·설계 분석에 사용하고 구현과 공식 리뷰는 별도 영구 handoff 세션으로 실행합니다.
