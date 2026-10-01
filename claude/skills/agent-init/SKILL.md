---
name: agent-init
description: 새 프로젝트에 AI 에이전트 작업 환경의 프로젝트 고유 파일(CLAUDE.md, AGENTS.md, docs/impact.md 와 생성기, .gitignore 항목, .claude/settings.local.json)을 만든다. 프로젝트 루트에서 "/agent-init" 또는 "이 프로젝트 에이전트 초기화해" 라고 하면 사용한다.
---

# agent-init — 프로젝트 고유 설정 초기화

전역 지침(`~/.claude/CLAUDE.md`)이 절차(계획/작업 세션, 핸드오프, `.agent-shared.md`)를 담당하고, 이 스킬은 **프로젝트마다 달라지는 파일**을 만든다. 영향 지도 생성기는 프로젝트 구조에 종속이므로 복사하지 않고 **조사 뒤 새로 작성**한다.

## 0. 쓰기 전 확인
- `git branch --show-current` 가 `main` 이면 **"브랜치를 바꿔야 합니다"** 라고 알리고 파일을 쓰지 않는다(전역 §0).
- 이미 `CLAUDE.md` 가 있으면 덮어쓰지 않고 멈춰 사용자에게 묻는다.

## 1. 조사 (`researcher` 서브에이전트, sonnet)
다음을 조사해 결론만 받는다: 언어·프레임워크, 빌드·테스트·실행 명령, 디렉터리 구조(백엔드/프론트/문서), DB 스키마 파일 위치, API 라우트 정의 위치, i18n 파일, 기존 `.gitignore`, 기존 문서 폴더.

## 2. `CLAUDE.md` 초안
`reference/CLAUDE.project.template.md` 를 골격으로 조사 결과를 채운다. 못 채운 칸은 `<!-- TODO: 확인 필요 -->` 로 남긴다. 완성 후 `AGENTS.md` 를 같은 내용으로 만든다. **둘 다 git 추적 대상이다**(2026-10-01 결정). 기존 `.gitignore` 에 `CLAUDE.md`/`AGENTS.md` 가 있으면 제거를 제안한다(제거는 사용자 승인 뒤).

## 3. 영향 지도
1. 조사 결과로 영향 지도의 축 후보를 정리한다 — 테이블·컬럼 / 엔드포인트 / 모듈 / 값 집합(enum·상수) / 성질(권한·표시 규칙 등).
2. **사용자에게 한 번 확인**받는다: 어느 축을 넣을지, 수동 절은 무엇인지.
3. `docs/tools/gen-impact.mjs` 를 **이 프로젝트 구조에 맞게 새로** 작성한다. `reference/gen-impact.rbm.mjs` 는 출력 형식·멱등 정렬·"설정 블록은 여기만 고친다" 구조의 참고 예시다. 그대로 복사하지 않는다.
4. 실행해 `docs/impact.md` 를 만든다. 첫 줄은 `기준: <git 짧은 해시> (<YYYY-MM-DD>) · 생성 절: ... · 수동 절: ...`.
5. 두 번 실행해 출력이 같은지 확인한다.

## 4. `.gitignore` 항목 추가
```
# 에이전트 세션 간 공유 메모 (로컬 작업 상태)
.agent-shared.md
# 임시 병렬 worktree (머지 후 자동 삭제 — 전역 CLAUDE.md §10)
worktrees/
```

## 5. `.claude/settings.local.json`
조사한 빌드·테스트·dev 서버 명령과 git 조회 명령을 `permissions.allow` 에 넣는다. 절대경로 `Read(//c/...)` 항목은 넣지 않는다(머신 종속).

## 6. 완료 보고
생성 파일 목록, `TODO` 칸 목록, 영향 지도 축과 수동 절, 사용자가 확인할 것. **커밋·머지는 언급하지 않는다**(전역 §1).
