# 경쟁 및 참고 프로젝트 분석

> ddmi 개발에 참고한 오픈소스 프로젝트들의 분석 결과와 접목 계획을 기록한다.

- **최종 수정**: 2026-03-17

---

## 1. CLIProxyAPI

- **URL**: https://github.com/router-for-me/CLIProxyAPI
- **Stars**: 17K+
- **언어**: Go
- **라이선스**: MIT
- **분석일**: 2026-03-16

### 개요

Claude Code, Codex 등 AI CLI 도구를 멀티 계정으로 로드밸런싱하는 프록시 서버. OpenAI 호환 API를 제공하여 여러 credential을 투명하게 관리한다.

### 핵심 패턴

| 패턴 | 설명 | ddmi 관련성 |
|------|------|-------------|
| **Credential Scheduler** | provider → model → credential 3계층 스케줄링. 유료 > 무료 우선순위. cooldown 자동 해제 | aimux v0.2.0 |
| **Retry + Cooldown** | 429 → 해당 credential cooldown + 다음 credential. Provider별 retry-after 파싱 | aimux v0.2.0 |
| **Model Registry** | credential별 사용 가능 모델 추적. Quota exceeded tracking | aimux v0.2.0 |
| **Model Mapping** | alias → upstream 매핑. Pool round-robin. Excluded 패턴 | aimux v0.3.0 |
| **SSE Streaming** | keep-alive heartbeat + bootstrap retry (첫 바이트 전만 retry) | aimux v0.3.0 |

### 가져가지 않는 것

| 항목 | 이유 |
|------|------|
| OAuth 토큰 추출 | aimux는 CLI spawn 방식 |
| User-Agent 위장 | 정상 CLI 사용 |
| Cloaking 시스템 | 윤리적 문제 |

### ddmi 적용 계획

- **Phase 2.7**: aimux v0.2.0 — Credential Scheduler + Retry + Cooldown
- **Phase 3**: aimux v0.3.0 — Model Mapping + SSE Streaming
- **Phase 3+**: aimux v1.0.0 — OpenAI 호환 API 서버 모드

상세: `packages/aimux/ROADMAP.md`

---

## 2. GitNexus

- **URL**: https://github.com/abhigyanpatwari/GitNexus
- **Stars**: 15.5K
- **언어**: TypeScript
- **라이선스**: PolyForm Noncommercial 1.0.0 (상업적 사용 불가)
- **분석일**: 2026-03-17

### 개요

코드베이스 전체를 지식 그래프로 인덱싱하여 AI 에이전트에게 구조적 코드 인텔리전스를 제공. "AI 에이전트의 신경계"를 자처. Tree-sitter AST 기반 13개 언어 파싱, LadybugDB 그래프 DB, Leiden 클러스터링.

### 기술 스택

| 계층 | 기술 |
|------|------|
| 파싱 | Tree-sitter (네이티브 + WASM) |
| 저장 | LadybugDB (그래프 + HNSW 벡터) |
| 임베딩 | snowflake-arctic-embed-xs (22M, 384d) |
| 검색 | BM25 + 시맨틱 벡터 (RRF k=60) |
| 그래프 | graphology + Leiden 커뮤니티 감지 |
| MCP | 7 tools + 5 resources + 2 prompts |
| Web | React + sigma.js + LangChain |

### 핵심 기능

| 기능 | 설명 |
|------|------|
| 6단계 인덱싱 | Structure → Parsing → Resolution → Clustering → Processes → Search |
| 블래스트 반경 분석 | 심볼 변경 시 영향받는 의존성 깊이별 추적 |
| Git diff 영향 | 변경 diff를 심볼로 매핑, 실행 흐름 추적 |
| 멀티파일 리네이밍 | 그래프 관계 기반 리네이밍 |
| Cypher 쿼리 | LadybugDB에 직접 그래프 쿼리 |
| 커뮤니티 기반 스킬 | Leiden 클러스터 → `.claude/skills/` 자동 생성 |
| 멀티 레포 | 글로벌 레지스트리 + lazy 커넥션 풀링 |

### ddmi에 접목할 패턴

| 패턴 | 설명 | 적용 시점 |
|------|------|-----------|
| **MCP Resources** | 읽기 전용 데이터를 리소스로 노출 → 에이전트가 프로젝트 상태를 "발견" | Phase 2.7 |
| **MCP Prompts** | 가이드 프롬프트로 에이전트의 활용 패턴을 안내 | Phase 2.7 |
| **Workflow Hints** | 도구 실행 후 다음 단계를 제안 → 에이전트 워크플로 가이드 | Phase 2.6 (소규모) |
| **Skills 자동 생성** | 인덱스 결과를 `.claude/skills/`로 내보내기 → 에이전트 메모리 | Phase 2.7 |
| **멀티 레포** | 글로벌 레지스트리로 여러 프로젝트를 단일 MCP에서 서빙 | Phase 3 |

### 가져가지 않는 것

| 항목 | 이유 |
|------|------|
| Tree-sitter AST 파싱 | ddmi는 코드가 아닌 문서(.md) 대상 |
| LadybugDB | SQLite + LanceDB 조합이 ddmi에 적합 |
| Leiden 클러스터링 | 문서 관계는 LLM 추출이 더 정확 |
| sigma.js 그래프 | React Flow가 이미 구현됨 |

---

## 3. ddmi vs 경쟁/참고 프로젝트 포지셔닝

### 비교 매트릭스

| 차원 | ddmi | GitNexus | CLIProxyAPI |
|------|------|----------|-------------|
| **대상** | .md 문서 | 소스 코드 (13개 언어) | AI CLI 프록시 |
| **핵심 문제** | 과거 결정과의 모순 방지 | 코드 구조/의존성 이해 | 멀티 계정 로드밸런싱 |
| **관계** | 보완 (같이 쓸 수 있음) | 보완 (코드+문서) | 하위 계층 (aimux에 흡수) |
| **LLM 의존도** | 핵심 경로 0회 | 핵심 경로 0회 | 프록시 (pass-through) |
| **라이선스** | MIT | PolyForm NC (상업 불가) | MIT |
| **해자 전략** | 피드백 학습 (시간 축적) | AST 파싱 정밀도 | 멀티 계정 관리 |

### ddmi 고유 강점 (다른 프로젝트에 없는 것)

| 강점 | 설명 |
|------|------|
| **충돌/모순 감지** | 문서 간 의미적 모순을 감지하고 알림 |
| **감사 추적** | SHA-256 해시 체인, 모든 변경에 rationale + based_on 필수 |
| **피드백 학습** | 사용할수록 프로젝트별로 최적화 (해자) |
| **Graceful Degradation** | 3단계: 오프라인 → 벡터 → LLM. 인터넷 없이도 동작 |
| **Context Curator** | 멀티팩터 스코어링 + 예산 패킹 + sibling/relation 확장 |

### ddmi가 배워야 할 것

| 출처 | 패턴 | ddmi 현재 | 목표 |
|------|------|-----------|------|
| GitNexus | MCP Resources | 0개 | 4개 (Phase 2.7) |
| GitNexus | MCP Prompts | 0개 | 2개 (Phase 2.7) |
| GitNexus | Workflow hints | 없음 | context_assemble에 추가 (Phase 2.6) |
| GitNexus | Skills 생성 | 없음 | `ddmi skills` (Phase 2.7) |
| GitNexus | 멀티 레포 | 없음 | Phase 3 |
| CLIProxyAPI | Credential Scheduler | 없음 | aimux v0.2.0 (Phase 2.7) |
| CLIProxyAPI | Retry + Cooldown | 없음 | aimux v0.2.0 (Phase 2.7) |
| CLIProxyAPI | Model Mapping | 없음 | aimux v0.3.0 (Phase 3) |
| CLIProxyAPI | SSE Streaming | 없음 | aimux v0.3.0 (Phase 3) |

---

## 4. 로드맵에 반영된 전체 흐름

```
Phase 2.6 (v0.3.0) — AI Integration & Scale
  └ 배치 분할, expandRelations, npm publish
  └ workflow hint (GitNexus 패턴, 소규모)

Phase 2.7 (v0.4.0) — MCP 심화 + Agent 통합
  └ MCP Resources 4종 (GitNexus 패턴)
  └ MCP Prompts 2종 (GitNexus 패턴)
  └ Skills 자동 생성 (GitNexus 패턴)
  └ aimux v0.2.0: Credential Scheduler + Retry (CLIProxyAPI 패턴)

Phase 3 (v0.5.0) — Intelligence + Multi-agent
  └ 피드백 가중치 학습
  └ shared_memory, event_broadcast
  └ 멀티 레포 (GitNexus 패턴)
  └ aimux v0.3.0: Model Mapping + Streaming (CLIProxyAPI 패턴)

Phase 3+ — 생태계
  └ aimux v1.0.0: OpenAI 호환 API 서버 (CLIProxyAPI 패턴)
```
