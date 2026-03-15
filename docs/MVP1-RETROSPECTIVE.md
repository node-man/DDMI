---
title: "MVP-1 회고"
date: "2026-03-16"
type: retrospective
---

# MVP-1 회고

> ddmi MVP-1의 전체 과정을 돌아본다. Sprint 0 + Week 4~8, 하루 만에.

## 숫자로 보는 MVP-1

| 항목 | MVP-0 | MVP-1 | 변화 |
|------|-------|-------|------|
| 테스트 | 59 | **150** | +91 |
| 테스트 파일 | 5 | **19** | +14 |
| MCP 도구 | 2 | **4** | +2 |
| CLI 명령 | 6 | **14** | +8 |
| AI Providers | 0 | **4** | +4 |
| 커밋 | 9 | **56** | +47 |
| PR 리뷰 | 0 | **4 PR, 14건 버그** | 신규 |
| npm 버전 | 0.1.0 | **0.2.0** | |
| 소요 시간 | 4시간 | **~8시간** | |

## 무엇을 만들었나

### 핵심 산출물

| 주차 | 산출물 | PR |
|------|--------|-----|
| Sprint 0 | 기술 부채 4건 해결 (Curator 테스트, config.toml, 한국어 매칭, 에러 복구) | v0.2.0-alpha |
| Week 4 | AI Provider 추상화 (claude, codex, gemini, ollama) + knowledge_query + Rate Limiter + BM25 Level 0 | v0.2.0-alpha |
| Week 5 | Relation Engine (3단계 추출) + SQLite 영속 큐 + MQ 패턴 worker | PR #1 |
| Week 6 | Audit Trail (SHA-256 해시 체인) + mutate_audited MCP (path traversal 방지) | PR #2 |
| Week 7 | Mission Control Dashboard (Hono + htmx) + ddmi status CLI + npm run dev | PR #3 |
| Week 8 | 통합 검증 + 테스트 보강 (117→150) + README + CHANGELOG + v0.2.0 | PR #4 |

### 아키텍처 변화

```
MVP-0:
  ddmi index → ddmi serve → context_assemble (MCP)

MVP-1:
  ddmi index --provider ollama → 관계 추출 + 충돌 감지 (SQLite 큐)
  ddmi serve --watch → MCP(4 tools) + Dashboard(3000) + Worker(큐 처리)
  ddmi audit --verify → 해시 체인 무결성 검증
  ddmi status → 프로젝트 건강도 한눈에
```

## 무엇을 배웠나

### 1. Gemini 할당량 폭주 사고 — 외부 API 안전장치의 중요성

healthCheck에서 `gemini prompt` (잘못된 subcommand) 사용 → 대화형 모드 → 내부 retry 1300회 → 최고 등급 할당량 전소.

**교훈:** 외부 API를 호출하는 코드에는 반드시:
- healthCheck에서 API 호출 금지 (`which`만 사용)
- Rate Limiter 필수 (분당 10회, 세션 100회)
- CLI 플래그를 `--help`로 검증 후 사용 (추측 금지)
- 모든 호출을 JSONL 로그에 기록

이 사고로 CLAUDE.md에 "External API Safety Rules" 6개 규칙이 추가됨.

### 2. PR 리뷰가 14건의 버그를 잡았다

| 유형 | 건수 | 예시 |
|------|------|------|
| 보안 | 2 | path traversal, 가짜 audit 기록 |
| 데이터 무결성 | 3 | incremental 링크 유실, stale 태스크, 해시 체인 불완전 |
| 설계 결함 | 5 | 1 task에 전체 pairs, silent error, giant prompt |
| 문서/버전 | 2 | 거짓 리인덱싱 주장, CLI 버전 하드코딩 |
| 테스트 부재 | 2 | 회귀 테스트 요구 |

**MVP-0에서는 PR 리뷰 없이 master에 직접 push했다.** MVP-1에서 feature branch + PR 리뷰를 도입한 것이 제품 품질에 결정적이었다.

### 3. QA 에이전트의 실패와 교정

QA를 수차례 실행했지만, 22개 모듈에 테스트가 없다는 사실을 "리스크"로만 분류하고 "GO LIVE"을 줬다. **테스트 커버리지 부재는 리스크가 아니라 blocker다.**

교정: QA 에이전트에 "테스트 커버리지 게이트"를 추가. core/ai/mcp/storage 모듈에 `.test.ts` 없으면 BLOCKED.

### 4. 사용자의 제품 감각이 방향을 교정했다

- "worker를 따로 띄우는 게 맞나?" → `ddmi index --provider ollama` 한 줄로 단순화
- "CLI 프로세스 관리 방식이 틀렸다" → spawn + process group + graceful shutdown
- "시각화가 전혀 없는데?" → Phase 2를 시각화 중심으로 재설계
- "기본기 위에 차별화가 올라가야 한다" → Layer 0 (기본기) + Layer 1 (차별화) 구조

### 5. Provider별 특성 이해

| Provider | 응답 시간 | 특성 |
|----------|----------|------|
| Ollama (qwen3.5:9b) | 1.6~62초 | HTTP worker, 프로세스 오버헤드 0, 느림 |
| Claude CLI | 4~15초 | 안정적, 일관된 품질 |
| Codex CLI | 4~7초 | 빠름, `exec -` subcommand |
| Gemini CLI | 12~16초 | `-p ""` + stdin, 세션 컨텍스트 자동 주입 |

## 무엇이 잘 됐나

### Feature Branch Workflow

Week 5부터 도입. PR 리뷰로 14건의 버그를 잡았다. MVP-0의 "master 직접 push"와 비교하면 품질이 완전히 다르다.

### MQ 패턴 (사용자 제안)

배치 병합 → MQ 순차 처리로 변경. 실패 격리, 분석 정확도, 응답성 모두 개선. 사용자가 "배치는 효율이 떨어진다"고 지적한 것이 결정적.

### API Safety Rules (사고 대응)

Gemini 사고 후 3레이어 방지책 (Rate Limiter + healthCheck 격리 + JSONL 로깅). 이후 동일 사고 0건.

## 무엇이 아쉬운가

### 1. 테스트 커버리지를 뒤늦게 잡았다

Week 8에서야 22개 모듈의 테스트 부재를 발견하고 보강. Week 4부터 각 주차마다 커버리지 게이트를 적용했어야 했다.

### 2. Dashboard 시각화 부재

Dashboard를 "최소화"로 설정했지만, 결과적으로 숫자만 나오는 텍스트 UI가 되었다. MVP-1에서 기본적인 차트라도 넣었어야 했다. Phase 2에서 보강 예정.

### 3. eval composite 개선 없음

MVP-0에서 0.217, MVP-1에서 0.188. 오히려 하락. 인덱스 파일 수 변화(6→14)와 questions.json의 expected_sources 미매칭이 원인. 실제 프로젝트에서 재측정 필요.

### 4. Gemini 사고 — 예방 가능했다

CLI 도구의 `--help`를 먼저 확인하지 않고 추측으로 플래그를 설정한 것이 근본 원인. "CLAUDE.md에 규칙을 추가"하는 것은 사후 대응이지 예방이 아니다. 앞으로 새 외부 도구 연동 시 반드시 `echo "test" | tool --flags` 수동 검증 후 코드에 반영해야 한다.

## Phase 2에서 해야 할 것

### 시각화 (핵심 — DDMI.md Phase 2에 반영 완료)

1. Knowledge Explorer — 파일 탐색 + MD 프리뷰 + 통합 검색
2. Knowledge Graph — D3.js force-directed + 시간 슬라이더 + 청크 줌
3. Conflict Resolution Studio — diff 뷰 + 컨텍스트 맵
4. Audit Timeline — 인터랙티브 타임라인 + Impact Trace
5. Health Dashboard — 게이지 + 트렌드 + 조기 경고

### 기술 전환

- htmx → React + Vite (컴포넌트 재사용, D3.js 통합)
- 차트: Recharts 또는 @visx
- 실시간: SSE

### 품질

- eval composite 0.5+ 목표 (실 프로젝트에서 questions.json 재작성)
- 50+ 파일 스케일 검증
- GitHub Actions CI

## 한 줄 요약

> MVP-1에서 차별화 핵심(충돌 감지 + 감사 추적)을 구현했지만, 시각화와 기본기의 부재를 사용자가 지적했고, Phase 2를 시각화 중심으로 재설계했다. PR 리뷰 도입으로 14건의 버그를 잡았고, Gemini 사고에서 외부 API 안전장치의 중요성을 배웠다.
