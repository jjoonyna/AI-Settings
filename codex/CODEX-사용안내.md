# Codex 사용 안내

이번에 Codex 를 처음 도입했다. 자주 쓸 것만 정리한다.

## 프로필 7개

| 무엇을 할 때 | 명령 | 모델 |
|---|---|---|
| **계획을 짤 때** (세션을 이걸로 연다) | `codex --profile plan` | GPT-6-Astra (읽기 전용) |
| astra 가 한도에 걸려 계획을 이어야 할 때 | `codex --profile plan-fallback` | GPT-5.6-Terra (읽기 전용) |
| **작업할 때** (세션을 이걸로 연다) | `codex --profile work` | GPT-5.6-Terra |
| 조사를 시킬 때 (세션 안에서) | `codex exec --profile research "지시"` | GPT-5.6-Luna (읽기 전용) |
| 코드 작업을 시킬 때 (세션 안에서) | `codex exec --profile build "지시"` | GPT-5.6-Luna |
| 변경이 너무 커서 나눠 검수할 때 | `codex --profile review` | GPT-5.6-Terra (읽기 전용) |
| **Claude 에서 한 큰 작업을 교차 검수할 때** | `codex --profile deep-review` | GPT-6-Astra (읽기 전용) |

**세션은 `plan` 또는 `work` 중 하나로 연다.** `research`·`build` 는 그 세션 안에서 `codex exec` 로 호출하는 하위 작업용이다 — 조사나 코드 작업을 시키면 별도 프로세스로 돌고 **결과만 돌아와서** 세션 토큰이 절약된다. 꼼꼼히 찾아보게 할수록 이득이 커진다.

**리뷰는 `work` 세션에서 직접 한다.** 따로 `review` 프로필로 열 필요가 없다 — 작업 맥락을 아는 쪽이 더 잘 본다. `review` 는 변경이 너무 커서 한 번에 못 볼 때만 쓴다.

**`deep-review` 는 Claude 에서 큰 작업을 한 뒤에 쓴다.** 같은 모델끼리는 같은 사각지대를 공유하니, 벤더를 바꿔 독립 검수하는 용도다. astra 라서 비싸므로 규모가 클 때만 쓰고, 도중에 부족하면 `codex --profile deep-review -m gpt-6.1-sol` 로 이어받는다.

## 프로필 없이 쓸 때

그냥 `codex` 를 실행하면 `~/.codex/config.toml` 의 기본 설정으로 뜬다.

## 모델만 한 번 바꿔 쓰고 싶을 때

```bash
codex -m gpt-6.1-sol
```

## 설정값을 한 번만 덮어쓰고 싶을 때

```bash
codex -c model_reasoning_effort="medium"
```

## 알아두면 좋은 옵션

| 옵션 | 뜻 |
|---|---|
| `--worktree` | 새 git worktree 에서 세션을 실행한다 |
| `-C, --cd <DIR>` | 작업 루트를 지정한다 |
| `--add-dir <DIR>` | 작업 디렉터리 밖의 경로에도 쓰기를 허용한다 |
| `codex resume` | 이전 세션을 이어서 연다 |
| `codex doctor` | 설치·설정·인증 상태를 진단한다 |

**`--add-dir` 이 필요한 경우:** `workspace-write` 샌드박스는 작업 디렉터리 **안쪽만** 쓰기를 허용한다. 홈 디렉터리(`~/.codex`, `~/.claude`)처럼 밖을 고쳐야 하면 이 옵션을 준다.

## 왜 astra 를 low 로 쓰는가

토큰 사용량이 매우 크기 때문이다. 제작사 기본값도 `low` 다. 계획 품질이 부족하면 reasoning 을 올리기보다 **입력(설계문서·브리핑)을 더 충실하게** 만들거나 조사를 더 시키는 편이 싸고 정확하다.

상한은 `medium` 이고 **`ultra` 는 금지**다 — "automatic task delegation" 이라 파생 세션이 생겨 비용이 배가될 수 있다.

## 규칙은 어디에 있나

- 전역: `~/.codex/AGENTS.md`
- rbm 프로젝트: `C:\ExRBM\rbm\AGENTS.md`

**Codex 는 `CLAUDE.md` 를 읽지 않는다. `AGENTS.md` 를 읽는다.**

## 사용 가능한 모델 목록 확인

```bash
cat ~/.codex/models_cache.json
```

`visibility` 가 `hide` 인 모델(`gpt-reserve`, `codex-auto-review`)은 내부 폴백용이므로 직접 지정하지 않는다.

## 모델 등급 요약 (2026-10-01 확인)

| 모델 | priority | reasoning 상한 | 성격 |
|---|---|---|---|
| `gpt-6.1-sol` | 1 | **ultra** | 기본 low, "Latest workhorse". 작업·검수·계획 폴백용 (Claude Opus 대응) |
| `gpt-6-astra` | 2 | **ultra** | 기본 low, "Frontier intelligence". 계획·교차검수용 (Claude Fable 대응) |
| `gpt-6-sol` | 3 | **ultra** | 이전 세대 workhorse. 사용하지 않음 |
| `gpt-6-luna` | 4 | max | 기본 medium, "Fast and affordable". 하위 조사·구현용 (Claude Sonnet 대응) |
| `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` | 5 / 8 / 9 | — | 구세대. 사용하지 않음 |

`context_window` 는 7개 모델 모두 272,000 으로 같다. 등급 구분선은 **`ultra` 지원 여부**와 **`visibility`** 다.
