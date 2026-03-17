# Phase 2.6 구현 계획서 — AI Integration & Scale

> Phase 2.5에서 구축한 AI 분석(분류, 관계, 충돌)을 핵심 파이프라인(Curator)에 연결하고,
> 대규모 레포에서도 동작하도록 AI 호출 구조를 개선한다.

- **시작일**: 2026-03-17
- **선행 조건**: Phase 2.5 PR #7 머지 완료
- **목표**: Level 2 산출물이 Level 1 품질에 측정 가능한 영향을 주는 것

---

## 1. 왜 필요한가

Phase 2.5에서 AI 분석 기능을 구현했지만, 4개 provider 테스트에서 드러난 사실:

| 발견 | 의미 |
|------|------|
| Ollama JSON 실패 | 통합 프롬프트가 소규모 모델에서 동작하지 않음 |
| Claude 23개 관계 추출 → eval 변화 없음 | Level 2 결과가 Level 1에 연결되지 않음 |
| 4 provider 모두 eval 0.629 동일 | AI 분석이 제품 가치에 기여하지 않는 상태 |
| 50파일 캡 → 500파일에서 90% 누락 | 현재 구조가 스케일하지 않음 |

**한 마디로**: AI 기능을 만들었지만 아직 의미가 없다. 연결해야 의미가 생긴다.

---

## 2. 목표 지표

| 지표 | 현재 | 목표 | 측정 방법 |
|------|------|------|-----------|
| Level 2 composite vs Level 1 composite | 동일 (0.629) | **+5% 이상** | `npm run eval` 비교 |
| Ollama AI 분석 성공률 | 0% | **80%+** | `ddmi index --provider ollama` |
| 500파일 AI 분석 커버리지 | 10% (캡) | **100%** | 배치 분할 후 전체 처리 확인 |
| source_precision | 0.237 | **0.28+** | `npm run eval` |

---

## 3. 작업 분해

### Week 1: 배치 분할 + Ollama 호환

**목표**: 통합 프롬프트를 배치로 분할하여 모든 provider에서 동작하게 만든다.

**Day 1-2: 배치 분할 엔진**

```
변경 파일: src/cli/index-cmd.ts
```

- `capFileSummaries()` → `batchFileSummaries()`로 교체
- provider별 배치 크기: `{ ollama: 10, codex: 50, gemini: 50, claude: 50 }`
- 각 배치에서: 분류 + 배치 내 관계 추출
- 배치별 결과를 SQLite에 누적 저장

**Day 3: 배치 간 관계 (교차 관계)**

```
변경 파일: src/cli/index-cmd.ts, src/core/relations.ts
```

- 배치 분석 완료 후, `findSimilarPairs()`로 배치 경계를 넘는 유사 쌍 추출
- 유사 쌍을 LLM에게 관계/충돌 판단 요청 (기존 패턴 재활용)
- 프롬프트는 쌍별로 작으므로 Ollama도 처리 가능

**Day 4: Ollama 호환 테스트**

- few-shot 예시 1개를 프롬프트에 추가 (JSON 형식 안내)
- ollama qwen3.5:9b로 10파일 배치 테스트
- 성공률 80%+ 확인

**검증 기준**:
- [ ] Ollama 10파일 배치에서 JSON 성공
- [ ] Claude 50파일 배치에서 동일 품질
- [ ] 18파일 프로젝트에서 4 provider 모두 AI 분석 성공

### Week 2: Level 2 → Level 1 연결

**목표**: AI 추출 관계가 Curator 스코어링에 반영되어, eval 점수가 측정 가능하게 개선된다.

**Day 1-2: Relation Boost in Curator**

```
변경 파일: src/core/curator.ts, src/types.ts
```

- `ScoringWeights`에 `relationBoost` 가중치 추가 (기본값 0.10)
- `scoreCandidates()`에서 DB 조회: 후보 청크와 관계가 있는 다른 후보가 있으면 부스트
- 부스트 계산: `relation.confidence × weight × 관계 유형 가중치`
  - `depends_on`: 1.0 (강한 연결)
  - `references`: 0.7
  - `derived_from`: 0.8
  - `supersedes`: 0.5
  - `contradicts`: 0.3 (충돌은 약한 부스트 — 충돌 블록으로 별도 처리)

**Day 3: eval 지표 확장**

```
변경 파일: src/cli/eval.ts, eval/questions.json
```

- `relation_utilization` 지표 추가: 선택된 블록 중 관계로 연결된 블록이 있는 비율
- before/after 비교를 위해 `--no-relations` 플래그 추가 (relation boost 비활성화)

**Day 4-5: 검증 + 가중치 튜닝**

- `ddmi index --provider claude` → `npm run eval` (with relations)
- `npm run eval -- --no-relations` (without relations)
- 차이가 +5% 미만이면 가중치 조정
- before/after 결과 문서화

**검증 기준**:
- [ ] relation boost 적용 후 eval composite가 Level 1 대비 +5% 이상
- [ ] source_precision 0.28+ 달성
- [ ] `--no-relations` 플래그로 A/B 비교 가능

### Week 3: npm publish + 마무리

**Day 1-2: npm publish 준비**

```
변경 파일: package.json, .github/workflows/ci.yml, README.md
```

- package.json `files` 필드 정리 (dist/, eval/questions.json만 포함)
- GitHub Actions: test → typecheck → build → npm publish (on tag)
- README: 설치 가이드, 빠른 시작, MCP 설정 방법

**Day 3: 500파일 스케일 검증**

- 대규모 테스트용 MD 파일 생성 스크립트
- `ddmi index` 성능 측정: 인덱싱 시간, 메모리, AI 배치 처리
- 목표: 500파일 < 5분 인덱싱

**Day 4-5: Phase 2.6 회고 + Phase 3 계획 업데이트**

- 결과 문서화 (before/after 비교)
- DDMI.md Phase 3 섹션 업데이트 (피드백 학습, shared_memory)
- CHANGELOG.md 업데이트

**검증 기준**:
- [ ] `npm pack` → 설치 테스트 성공
- [ ] GitHub Actions CI green
- [ ] 500파일 인덱싱 < 5분

---

## 4. 아키텍처 변경

### 4.1 배치 분할 흐름

```
현재:
  18파일 → 1회 통합 프롬프트 → 분류 + 관계 + 충돌

Phase 2.6:
  500파일 → 배치 분할 (provider별 크기)
    배치 1: [파일 1~50] → LLM → 분류 + 배치 내 관계
    배치 2: [파일 51~100] → LLM → 분류 + 배치 내 관계
    ...
  → 벡터 유사도로 배치 간 후보 쌍 추출
  → LLM → 교차 관계 + 충돌 검증
```

### 4.2 Curator 스코어링 변경

```
현재:
  score = sim × 0.55 + kw × 0.15 + taa × 0.15 + rec × 0.15

Phase 2.6:
  score = sim × 0.50 + kw × 0.15 + taa × 0.15 + rec × 0.10 + rel × 0.10

  rel = relationBoost(chunkId, selectedChunks, relations)
```

가중치 합 = 1.0 유지. `sim`과 `rec`에서 0.10을 재분배.

### 4.3 새 파일

| 파일 | 역할 |
|------|------|
| `src/ai/batch.ts` | 배치 분할 로직 (provider별 크기, 변경 파일 우선) |

### 4.4 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/cli/index-cmd.ts` | 통합 프롬프트 → 배치 호출로 교체 |
| `src/core/curator.ts` | `relationBoost` 추가, 가중치 재분배 |
| `src/types.ts` | `ScoringWeights.relationBoost` 추가 |
| `src/cli/eval.ts` | `relation_utilization` 지표, `--no-relations` 플래그 |
| `eval/questions.json` | 필요 시 보정 |

---

## 5. 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| relation boost가 eval을 악화시킬 수 있음 | 관련 없는 관계가 노이즈로 작용 | `--no-relations` A/B 비교로 즉시 감지 → 가중치 0으로 롤백 |
| 배치 분할로 LLM 호출 수 증가 → 비용/시간 | 10배치 = 10회 호출 | Rate limiter 기존 적용, provider 할당량 내 |
| 배치 간 관계 누락 | 교차 관계를 벡터 유사도에 의존 | 유사도 threshold 조정으로 커버리지 확보 |
| Ollama few-shot이 여전히 실패 | 소규모 모델 한계 | 배치 5파일까지 축소 + 더 큰 모델 권장 문서화 |

---

## 6. Phase 3과의 관계

Phase 2.6은 **기존 기능의 연결과 검증**이다. Phase 3은 **새로운 능력 추가**이다.

| | Phase 2.6 (이번) | Phase 3 (다음) |
|---|---|---|
| 핵심 | Level 2 → Level 1 연결 | 피드백 학습 + Multi-agent |
| 성격 | 만든 것을 쓸모있게 | 새로운 것을 만듦 |
| 의존 | Phase 2.5 산출물 | Phase 2.6 산출물 (relation이 작동해야 학습 가능) |
| 출시 | v0.3.0 (npm publish 포함) | v0.4.0 |

Phase 2.6을 먼저 해야 Phase 3의 "피드백 가중치 학습"이 의미가 있다 — relation이 Curator에 반영되어야 학습할 대상이 생긴다.

---

## 7. 마일스톤 요약

| 주차 | 산출물 | 성공 기준 |
|------|--------|-----------|
| Week 1 | 배치 분할 + Ollama 호환 | 4 provider 모두 AI 분석 성공 |
| Week 2 | Level 2→1 연결 + eval 검증 | composite +5%, source_precision 0.28+ |
| Week 3 | npm publish + 스케일 검증 | v0.3.0 publish, 500파일 < 5분 |
