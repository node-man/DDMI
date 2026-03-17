# Phase 2.6 구현 계획서 — AI Integration & Scale

> Phase 2.5에서 구축한 AI 분석(분류, 관계, 충돌)을 핵심 파이프라인(Curator)에 연결하고,
> 대규모 레포에서도 동작하도록 AI 호출 구조를 개선한다.

- **시작일**: 2026-03-17
- **선행 조건**: Phase 2.5 PR #7 머지 완료
- **목표**: Level 2 산출물이 Level 1 품질에 측정 가능한 영향을 주는 것
- **버전**: v0.3.0

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
| fact_recall (with relations) | 0.782 | **≥ 0.82** | `npm run eval` |
| fact_recall (without relations) | 0.782 | 기준선 유지 | `npm run eval -- --no-relations` |
| composite (with relations) | 0.629 | **≥ 0.66** | `npm run eval` |
| Ollama AI 분석 성공률 | 0% | **80%+** | `ddmi index --provider ollama` |
| 500파일 AI 분석 커버리지 | 10% (캡) | **100%** | 배치 분할 후 전체 처리 확인 |
| source_precision | 0.237 | **≥ 0.28** | `npm run eval` |

**핵심 검증 방법**: `--no-relations` A/B 비교. fact_recall이 올라가면 관계 확장이 진짜 기여한 것. 안 올라가면 노이즈 — 가중치 0으로 롤백.

별도의 `relation_utilization` 지표는 만들지 않는다. connected-but-irrelevant 블록을 보상할 위험이 있고, 기존 fact_recall/source_recall 비교만으로 충분하다.

---

## 3. 설계 결정 (열린 질문 해소)

### 3.1 relation boost 알고리즘: graph expansion after packing

**문제**: 문서 초안은 `scoreCandidates()` 안에서 관계 부스트를 계산하겠다고 했지만, Curator 파이프라인은 `scoreCandidates()` → `packBudget()` → `expandSiblings()` 순서다. `selectedChunks`는 packing 후에야 존재하므로, scoring 단계에서 참조할 수 없다.

**결정**: sibling expansion과 동일한 패턴으로 **packing 후 관계 확장**.

```
현재 파이프라인:
  scoreCandidates() → packBudget() → expandSiblings() → 조립

Phase 2.6:
  scoreCandidates() → packBudget() → expandSiblings() → expandRelations() → 조립
                                                          ↑ NEW
```

`expandRelations()` 동작:
1. 선택된 청크들의 파일 ID 수집
2. DB에서 해당 파일과 관계가 있는 **다른 파일**의 청크 조회
3. 관계 신뢰도 × 유형 가중치로 정렬
4. 예산 내에서 상위 청크 추가 (sibling과 별도 예산: direct budget의 20%)
5. `--no-relations` 플래그로 이 단계를 skip

**스코어링 공식은 변경하지 않는다.** 기존 가중치 재분배 없이, 순수하게 "선택 후 관계 기반 확장"으로 구현. 이러면:
- A/B 비교가 깔끔 (확장 ON/OFF만)
- 기존 스코어링 회귀 위험 0
- sibling expansion과 동일한 검증된 패턴

### 3.2 npm publish 전략: aimux 먼저 publish

**문제**: `package.json`의 `"aimux": "workspace:*"`는 외부 설치자에게 깨진다.

**결정**: aimux를 npm에 독립 publish → ddmi가 `"aimux": "^0.1.0"`으로 의존.

```
publish 순서:
1. aimux@0.1.0 → npm publish (packages/aimux/)
2. ddmi package.json: "aimux": "workspace:*" → "aimux": "^0.1.0"
3. ddmi@0.3.0 → npm publish
```

aimux는 독립 가치가 있다 (AI CLI multiplexer). MIT 라이선스. 별도 publish가 가장 깔끔.

---

## 4. 작업 분해

### Week 1: 배치 분할 + Ollama 호환 + 테스트 기반

**목표**: 통합 프롬프트를 배치로 분할하여 모든 provider에서 동작하게 만든다.

**Day 1: 배치 분할 엔진 + 테스트**

```
새 파일: src/ai/batch.ts, src/ai/batch.test.ts
변경 파일: src/cli/index-cmd.ts
```

- `batchFileSummaries()` 함수: provider별 배치 크기, 변경 파일 우선
- provider별 배치 크기: `{ ollama: 10, codex: 50, gemini: 50, claude: 50 }`
- **테스트 먼저**: 배치 분할 로직 단위 테스트 (크기, 우선순위, 경계 조건)

**Day 2: index-cmd 배치 호출 통합 + Dashboard API 테스트**

```
변경 파일: src/cli/index-cmd.ts
새 파일: src/dashboard/server.test.ts
```

- 기존 단일 프롬프트 → 배치 루프로 교체
- 배치별 결과 누적 저장 (분류, 관계)
- **Dashboard API 핵심 테스트**: `/api/providers`, `/api/index`, `/api/knowledge-query` (PR #7 5차 리뷰 교훈 — 테스트를 미루지 않는다)

**Day 3: 배치 간 관계 (교차 관계)**

```
변경 파일: src/cli/index-cmd.ts, src/core/relations.ts
```

- 배치 분석 완료 후, `findSimilarPairs()`로 배치 경계를 넘는 유사 쌍 추출
- 유사 쌍을 LLM에게 관계/충돌 판단 요청 (기존 패턴 재활용)
- 프롬프트는 쌍별로 작으므로 Ollama도 처리 가능

**Day 4: Ollama 호환 + 전 provider 테스트**

- few-shot 예시 1개를 프롬프트에 추가 (JSON 형식 안내)
- 4 provider 전부 reindex 테스트 (ollama, codex, gemini, claude)
- 성공률 기록

**Day 5: 인덱싱 성능 프로파일링**

- 배치 분할 전후 인덱싱 시간 비교 (18파일 기준)
- 임베딩 vs AI 호출 vs DB 저장 시간 분리 측정
- 병목 식별 → Week 3 스케일 검증에 반영

**검증 기준**:
- [ ] 배치 분할 단위 테스트 통과
- [ ] Dashboard API 핵심 3개 엔드포인트 테스트 통과
- [ ] Ollama 10파일 배치에서 JSON 성공
- [ ] 4 provider 모두 AI 분석 성공

### Week 2: Level 2 → Level 1 연결 (relation expansion)

**목표**: AI 추출 관계가 context_assemble 결과에 반영되어, fact_recall이 측정 가능하게 개선된다.

**Day 1-2: expandRelations() 구현 + 테스트 + workflow hint**

```
변경 파일: src/core/curator.ts, src/core/curator.test.ts
```

- `expandSiblings()` 뒤에 `expandRelations()` 추가
- 동작: 선택된 파일과 관계가 있는 다른 파일의 청크를 예산 내에서 추가
- 관계 유형별 가중치:
  - `depends_on`: 1.0
  - `derived_from`: 0.8
  - `references`: 0.7
  - `supersedes`: 0.5
  - `contradicts`: 0.3
- 예산: direct budget의 20% (sibling 30%와 별도)
- **테스트**: 관계가 있을 때 확장, 없을 때 미변경, 예산 초과 시 중단
- **workflow hint**: context_assemble 응답에 `hint: "context_feedback으로 유용도를 알려주세요"` 추가 (GitNexus 패턴)

**Day 3: eval --no-relations 플래그**

```
변경 파일: src/cli/eval.ts, src/cli/main.ts
```

- `--no-relations` 플래그: `expandRelations()` 스킵
- A/B 비교 실행: with vs without

**Day 4-5: 검증 + 가중치 튜닝**

- `ddmi index --provider claude` → eval A/B 비교
- fact_recall delta가 +0.03 미만이면 관계 유형 가중치/예산 비율 조정
- 최종 before/after 결과 문서화

**검증 기준**:
- [ ] expandRelations() 단위 테스트 통과 (4+ 케이스)
- [ ] `--no-relations` A/B 비교 가능
- [ ] fact_recall (with) > fact_recall (without) — 순수 기여 입증
- [ ] composite ≥ 0.66

### Week 3: npm publish + 마무리

**Day 1: aimux publish**

```
변경 파일: packages/aimux/package.json
```

- `npm view aimux` — 이름 충돌 확인. 충돌 시 `@ddmi/aimux` 사용
- aimux@0.1.0 npm publish
- ddmi의 `"aimux": "workspace:*"` → `"aimux": "^0.1.0"` (또는 `@ddmi/aimux`) 변경
- `npm install` 동작 확인

**Day 2: ddmi publish 준비**

```
변경 파일: package.json, .github/workflows/ci.yml, README.md
```

- package.json `files` 필드 정리
- GitHub Actions: test → typecheck → build → npm publish (on tag)
- README: 설치 가이드, 빠른 시작, MCP 설정 방법

**Day 3: 500파일 스케일 검증**

- 대규모 테스트용 MD 파일 생성 스크립트
- `ddmi index` 성능 측정: 인덱싱 시간, 메모리, AI 배치 처리
- 목표: 500파일 < 5분 인덱싱

**Day 4-5: v0.3.0 publish + Phase 2.6 회고**

- `npm pack` → 외부 프로젝트에서 설치 테스트
- v0.3.0 tag → npm publish
- Phase 2.6 회고 문서 작성
- DDMI.md Phase 3 섹션 업데이트
- CHANGELOG.md 업데이트

**검증 기준**:
- [ ] aimux@0.1.0 npm publish 성공
- [ ] ddmi@0.3.0 `npm pack` → 외부 설치 성공
- [ ] GitHub Actions CI green
- [ ] 500파일 인덱싱 < 5분

---

## 5. 아키텍처 변경

### 5.1 배치 분할 흐름

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

### 5.2 Curator 파이프라인 변경

```
현재:
  scoreCandidates() → packBudget() → expandSiblings() → 조립

Phase 2.6:
  scoreCandidates() → packBudget() → expandSiblings() → expandRelations() → 조립
                                                          ↑ NEW

expandRelations():
  1. 선택된 청크의 파일 ID 수집
  2. DB에서 관계가 있는 다른 파일의 청크 조회
  3. 관계 신뢰도 × 유형 가중치로 정렬
  4. 예산 내(direct budget × 20%)에서 상위 추가
  5. --no-relations → skip
```

스코어링 공식은 **변경하지 않는다**. 가중치 재분배 없음.

### 5.3 npm publish 구조

```
publish 순서:
  1. packages/aimux/ → npm publish aimux@0.1.0
  2. package.json "aimux": "workspace:*" → "^0.1.0"
  3. npm publish ddmi@0.3.0

ddmi@0.3.0 files:
  dist/           (compiled JS)
  dist/client/    (React SPA build)
  eval/questions.json
  package.json
  README.md
```

### 5.4 새 파일

| 파일 | 역할 |
|------|------|
| `src/ai/batch.ts` | 배치 분할 로직 (provider별 크기, 변경 파일 우선) |
| `src/ai/batch.test.ts` | 배치 분할 단위 테스트 |
| `src/dashboard/server.test.ts` | Dashboard API 핵심 테스트 |

### 5.5 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/cli/index-cmd.ts` | 통합 프롬프트 → 배치 호출로 교체 |
| `src/core/curator.ts` | `expandRelations()` 추가 (packing 후, sibling 후) |
| `src/core/curator.test.ts` | expandRelations 테스트 |
| `src/cli/eval.ts` | `--no-relations` 플래그 |
| `packages/aimux/package.json` | publish 준비 |
| `package.json` | `aimux` 의존성 변경, files 필드 |

---

## 6. 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| relation expansion이 fact_recall을 악화시킴 | 무관 청크가 예산 차지 | `--no-relations` A/B 비교로 즉시 감지 → 비활성화 |
| 배치 분할로 LLM 호출 수 증가 | 비용/시간 | Rate limiter, provider 할당량 내 |
| 배치 간 관계 누락 | 교차 관계를 벡터 유사도에 의존 | 유사도 threshold 조정 |
| Ollama few-shot이 여전히 실패 | 소규모 모델 한계 | 배치 5파일까지 축소 + 큰 모델 권장 문서화 |
| aimux npm publish 이름 충돌 | 이미 존재하는 패키지명 | `npm view aimux` 사전 확인, 필요 시 `@ddmi/aimux` |

---

## 7. Phase 3과의 관계

Phase 2.6은 **기존 기능의 연결과 검증**이다. Phase 3은 **새로운 능력 추가**이다.

| | Phase 2.6 (이번) | Phase 3 (다음) |
|---|---|---|
| 핵심 | Level 2 → Level 1 연결 | 피드백 학습 + Multi-agent |
| 성격 | 만든 것을 쓸모있게 | 새로운 것을 만듦 |
| 의존 | Phase 2.5 산출물 | Phase 2.6 산출물 |
| 출시 | v0.3.0 (npm publish) | v0.4.0 |

Phase 2.6을 먼저 해야 Phase 3의 "피드백 가중치 학습"이 의미가 있다 — relation expansion이 Curator에서 작동해야 학습할 대상이 생긴다.

---

## 8. 마일스톤 요약

| 주차 | 산출물 | 성공 기준 |
|------|--------|-----------|
| Week 1 | 배치 분할 + Ollama 호환 + 테스트 기반 | 4 provider AI 성공, batch/dashboard 테스트 통과 |
| Week 2 | expandRelations + eval A/B 검증 | fact_recall 순수 개선 입증, composite ≥ 0.66 |
| Week 3 | aimux + ddmi npm publish, 500파일 검증 | v0.3.0 외부 설치 성공, 500파일 < 5분 |
