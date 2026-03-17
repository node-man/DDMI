# Phase 2~2.5 회고

- **기간**: 2026-03-16 ~ 2026-03-17
- **범위**: Phase 2 (React SPA 전환) + Phase 2.5 (Dashboard AI Ops)
- **PR**: #5 (Phase 2), #6 (aimux SDK), #7 (Phase 2.5)

---

## 숫자로 보는 Phase 2~2.5

| 항목 | Phase 2 | Phase 2.5 | 합계 |
|------|---------|-----------|------|
| 커밋 | 18 | 27 | 45 |
| 변경 파일 | 92 | 49 | - |
| 추가 코드 | +15,649줄 | +3,919줄 | +19,568줄 |
| 삭제 코드 | -1,477줄 | -907줄 | -2,384줄 |
| PR | 1 (#5) | 2 (#6, #7) | 3 |
| PR 리뷰 라운드 | 1 | 5 (PR #7) | 6 |
| 테스트 | 150 → 150 | 150 → 159 | +9 |
| React 컴포넌트 | 0 → 21 | 21 → 25 | 25 |

### 주요 산출물

**Phase 2:**
- React 19 + Vite 7 + Tailwind 4 SPA (htmx 완전 제거)
- 6개 Dashboard 페이지 (Health, Explorer, Graph, Conflicts, Audit, Settings)
- Drizzle ORM 마이그레이션 (raw SQL → 타입 안전)
- React Flow + dagre 자동 레이아웃 (Knowledge Graph)
- ECharts 게이지 (Health Dashboard)

**Phase 2.5:**
- aimux SDK 독립 추출 (packages/aimux/)
- AI doc classification (LLM으로 문서 유형 분류)
- 통합 AI 프롬프트 (46호출 → 3호출 → 1호출)
- Sibling section expansion (hierarchical retrieval)
- eval 프레임워크 수정 (expected_sources 재매핑)
- RFC-001 임베딩 업그레이드 분석 + First Principles 리뷰

---

## 잘한 것

### 1. eval 프레임워크 깨진 것을 발견했다

eval composite가 0.185에서 올라가지 않는 이유가 임베딩 품질이 아니라 **eval 자체의 expected_sources 경로 불일치**였음을 발견. 수정 후 0.572 → sibling expansion 적용 후 **0.629**. 목표 0.5+ 달성.

**교훈**: 측정 도구를 먼저 검증해야 한다. 깨진 측정기로 품질을 개선하려는 시도는 시간 낭비.

### 2. First Principles 리뷰가 잘못된 방향을 막았다

RFC-001이 "bge-m3 즉시 교체"를 제안했지만, First Principles 리뷰가 "retrieval 구조가 더 큰 병목"임을 밝혀냄. sibling expansion만으로 fact_recall +20% 달성. **임베딩 교체 없이도 목표 도달**.

**교훈**: 기술적 결정 전에 가정을 검증하라. "더 큰 모델 = 더 나은 결과"는 항상 참이 아니다.

### 3. PR 리뷰가 5차까지 갔지만 매번 실제 버그를 잡았다

PR #7 리뷰 5라운드:
1. AI capabilities frozen at startup → 동적 resolve
2. Per-request router rebuild → 리소스 누수 → 캐시
3. Stale cache → TTL 갱신
4. TTL rebuild embedder 재부팅 → existingEmbedder 전달
5. 회귀 테스트 부재 → 테스트 추가

**교훈**: 5라운드가 과하다고 느낄 수 있지만, 매 라운드마다 실제 프로덕션 버그를 잡았다. 리뷰를 생략하거나 급하게 머지했으면 사용자가 겪을 문제였다.

### 4. 4 provider 실사용 테스트

ollama, codex, gemini, claude로 전부 reindex + query + eval을 직접 실행. ollama JSON 실패를 발견하고, 프롬프트 스케일 문제를 사전에 인지.

**교훈**: 단위 테스트는 "코드가 맞나"를 확인하고, 실사용 테스트는 "제품이 되나"를 확인한다. 둘 다 필요하다.

---

## 아쉬운 것

### 1. AI 분석 결과가 핵심 파이프라인과 단절되어 있다

claude가 23개 관계를 추출해도 eval 점수에 **영향 0**. Level 2 기능(분류, 관계, 충돌)이 Level 1(Curator 스코어링)에 연결되지 않았다.

**Phase 2.5에서 AI 분석을 "만들었다"고 했지만, 실제로는 "저장만 했다".** Graph에서 시각화되지만, 핵심 가치인 context_assemble에는 기여하지 않는다.

→ **Phase 2.6에서 해결 예정** (relation boost)

### 2. 통합 프롬프트가 스케일하지 않는다

46호출 → 1호출 최적화는 비용/속도 관점에서 성공이었지만, **500파일 레포에서는 동작하지 않는다**. 50파일 캡을 넣었지만 이건 임시방편.

또한 Ollama 같은 소형 모델은 10KB 프롬프트도 처리 못한다.

→ **Phase 2.6에서 배치 분할로 해결 예정**

### 3. eval이 Level 1만 측정한다

현재 eval은 "올바른 문서를 골라주나?"만 측정. "관계를 활용해서 더 좋은 결과를 주나?"는 측정할 방법이 없다. Level 2의 가치를 입증할 지표가 부재.

→ **Phase 2.6에서 relation_utilization 지표 추가 예정**

### 4. 용어 불일치: MVP → Phase

MVP-0, MVP-1까지는 "최소 기능 제품 증명"이었는데, Phase 2부터는 명시적 결정 없이 "Phase"로 바뀌었다. 문서마다 혼재.

→ **정리 제안**: 앞으로 버전 기반으로 통일
- v0.1.0 (MVP-0), v0.2.0 (MVP-1), v0.3.0 (Phase 2.6) 처럼 버전과 phase를 병기
- "MVP"는 v0.1~0.2에만 사용, 이후는 "Phase N" 또는 "vX.Y.0"

---

## 발견된 기술 부채

| # | 부채 | 영향 | 해결 시점 |
|---|------|------|-----------|
| 1 | Level 2 → Level 1 단절 | 차별화 기능이 제품 가치에 무기여 | Phase 2.6 |
| 2 | 통합 프롬프트 스케일 한계 | 50+ 파일에서 AI 기능 불완전 | Phase 2.6 |
| 3 | Ollama JSON 생성 실패 | 로컬 LLM 사용자에게 Level 2 불가 | Phase 2.6 |
| 4 | Dashboard API 테스트 부재 | 5라운드 리뷰의 원인 | Phase 2.6 or 3 |
| 5 | 인덱싱 180초 (18파일) | 500파일 목표 (5분) 대비 과도 | Phase 2.6 |
| 6 | source_precision 0.237 | 목표 0.30 미달 | Phase 2.6 |

---

## Phase 2.6 계획에 대한 회고 기반 피드백

현재 PHASE2.6-PLAN.md를 검토한 결과:

### 유지할 것
- 3주 타임박스 적절
- Level 2→1 연결이 최우선인 것 맞음
- 배치 분할과 Ollama 호환을 Week 1에 먼저 하는 순서 올바름

### 보완할 것
1. **"composite +5%" 목표가 너무 모호** — 0.629에서 +5%면 0.660. 구체적 숫자로: `composite ≥ 0.66, source_precision ≥ 0.28`
2. **Dashboard API 테스트** — PR #7 리뷰에서 5차까지 간 원인. Phase 2.6에서 최소 핵심 엔드포인트 테스트 추가 필요
3. **eval before/after 프로토콜 명시** — 매 개선마다 `--no-relations` A/B 비교를 표준 절차로
4. **인덱싱 180초 문제** — Week 3 스케일 검증 때만이 아니라, Week 1에서 배치 분할하면서 병행 측정

---

## 한 줄 요약

> Phase 2~2.5는 **보이는 것(Dashboard, Graph, AI 분석)**을 만들었고, Phase 2.6은 **작동하는 것(Level 2→1 연결, 스케일, 출시)**을 만들어야 한다.
