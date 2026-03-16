# RFC-001: 임베딩 모델 업그레이드

- **상태**: Draft
- **작성일**: 2026-03-16
- **작성자**: ddmi 팀
- **관련 문서**: `CLAUDE.md`, `eval/results/hybrid_tuning_2026-03-15.json`, `eval/results/package_a_results.json`, `eval/corpus/research/embedding-models-comparison.md`, `eval/corpus/research/day1-experiment-results.md`

---

## 1. 요약 (Executive Summary)

ddmi의 핵심 가치는 `context_assemble`을 통해 AI 에이전트에게 최적의 컨텍스트를 조립하여 제공하는 것이다. 그러나 현재 임베딩 모델(`paraphrase-multilingual-MiniLM-L12-v2`, 384차원, 2022년)의 의미 표현 능력 한계로 인해 eval composite가 0.188~0.687 수준에 머물러 있으며, 사용자가 "수동 선택보다 낫다"고 체감하려면 fact_recall 0.65+ 이상이 필요하다. 본 RFC는 임베딩 모델을 `BAAI/bge-m3`(1024차원)로 업그레이드하여 검색 품질을 근본적으로 개선할 것을 제안한다.

---

## 2. 문제 정의 (Problem Statement)

### 2.1. context_assemble은 ddmi의 핵심 가치다

ddmi의 존재 이유는 "AI 에이전트에게 최적의 컨텍스트를 조립해 제공"하는 것이다. `context_assemble`의 파이프라인은 `임베딩 → 벡터 검색 → 스코어링 → 패킹 → 조립`으로 구성되며, LLM 호출 0회로 동작한다. 따라서 **임베딩 품질이 곧 제품 품질**이다.

### 2.2. 현재 검색 품질은 제품 가치 미달이다

MVP-0 완료 시점(2026-03-15)의 eval 결과:

| 지표 | 수치 | 목표 | 상태 |
|------|------|------|------|
| eval composite (초기 5파일) | 0.217 | 0.5+ | 미달 |
| fact_recall (full 33, approach D) | 0.838 | 0.65+ | 충족 |
| fact_recall (full 33, approach B) | 0.777 | 0.65+ | 충족 |
| source_recall (full 33, approach D) | 0.773 | - | 개선 여지 |
| source_precision (full 33) | 0.214 | - | 낮음 |

> **참고**: 초기 eval composite 0.217은 인덱싱된 파일이 5개뿐이었던 시점의 수치다. 이후 63파일 코퍼스로 확장한 standalone retrieval 실험에서 composite 0.687(D), 0.652(B)까지 개선되었다. 그러나 Codex end-to-end answer quality 평가에서는 여전히 전체 덤프(A)가 큐레이션(D)보다 accuracy, specificity, hallucination_free 전 항목에서 우세했다.

### 2.3. source_recall 0.000 문제 (별도 이슈)

`eval/questions.json`의 `expected_sources` 경로와 실제 인덱싱된 파일 경로의 불일치로 인해 초기 source_recall이 0.000으로 측정되었다. 이는 임베딩 모델 자체의 문제가 아니라 eval 프레임워크의 경로 매칭 이슈로, 별도로 수정되었다.

### 2.4. 체감 품질 기준

사용자가 "수동으로 MD 파일을 골라서 에이전트에게 넣는 것보다 낫다"고 느끼려면:

- **fact_recall 0.65+**: 질문의 핵심 사실 중 65% 이상을 포함하는 컨텍스트 조립
- **source_precision 향상**: 관련 없는 청크가 상위에 노출되는 빈도 감소
- **answer quality에서 A(전체 덤프)와 동등 이상**: 현재 미달 상태

---

## 3. 배경 (Background)

### 3.1. ddmi의 3단계 Graceful Degradation

ddmi는 환경에 따라 3단계로 동작하도록 설계되어 있다:

| Level | 조건 | 가용 기능 |
|-------|------|-----------|
| **Level 0** | 오프라인, 모델 미다운로드 | explicit link + frontmatter + BM25 키워드 검색 |
| **Level 1** | transformers.js 임베딩 사용 | + 벡터 유사도 검색 (임베딩 모델) |
| **Level 2** | + Ollama/CLI/API LLM | + 관계 추출, 충돌 감지, 문서 분류 |

### 3.2. Level 1이 핵심이다

`context_assemble`의 쿼리 경로는 Level 1에서 완전히 동작한다:

```
질의 → 임베딩(transformers.js) → 벡터 검색(LanceDB) → 스코어링(수학) → 패킹(알고리즘) → 조립(문자열)
```

LLM 호출 0회. 따라서 **Level 1의 임베딩 모델이 context_assemble의 품질 상한을 결정**한다. 스코어링 가중치, 패킹 전략, hybrid 검색 등은 모두 임베딩 품질 위에서 동작하는 후처리일 뿐이다.

### 3.3. 임베딩 모델 선택 히스토리

Day 1 가설 검증 실험(2026-03-13 준비, 2026-03-15 실행)에서 `paraphrase-multilingual-MiniLM-L12-v2`를 선택했다:

- **선택 이유**:
  - 한국어/영어 혼합 프로젝트 지원 (50+ 언어)
  - `@xenova/transformers`(npm install)만으로 동작, 외부 서버 불필요
  - 260MB로 가벼움, CPU에서 ~80ms/청크
  - `eval/corpus/research/embedding-models-comparison.md`에서 한국어 성능 비교 후 결정
- **당시 판단**: "MVP-0에서 충분. 나중에 업그레이드."
- **근거 문서**: `decisions/adr-009-transformers-embedding.md`, `meetings/2026-03-12-embedding-model-selection.md`

---

## 4. 현재 임베딩 모델 분석

### 4.1. 모델 사양

| 항목 | 값 |
|------|-----|
| 모델 | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` |
| 차원 | 384 |
| 레이어 | 12 |
| 크기 | ~260MB (quantized) |
| 학습 시기 | 2022년 |
| MTEB Retrieval 벤치마크 | ~55점 |
| transformers.js 호환 | O |
| 다국어 지원 | 50+ 언어 |

### 4.2. 장점

- **가볍고 빠름**: 260MB 다운로드, CPU ~80ms/청크, 인덱싱 시 63파일/441청크를 ~2초에 임베딩
- **다국어 지원**: 한국어에서도 영어의 ~85% 수준 품질 유지 (all-MiniLM-L6-v2 대비 2배 이상)
- **transformers.js 호환**: npm install만으로 동작, Ollama나 API 서버 불필요
- **검증된 안정성**: MVP-0 전체를 이 모델로 개발/테스트 완료

### 4.3. 단점

- **384차원의 의미 정보 부족**: 최신 모델은 768~1024차원으로, 동일 텍스트에서 더 풍부한 의미 관계를 포착한다. 384차원은 미묘한 의미 차이(예: "임베딩 모델 선택 기준" vs "모델 비교 분석")를 구분하기 어렵다.
- **한국어 임베딩 품질 한계**: 영어 대비 ~85% 수준이라고는 하지만, 이는 여전히 15% 정보 손실을 의미한다. 한국어 키워드가 포함된 질의에서 관련 없는 청크가 상위 10에 자주 노출된다 (eval Q24: `review-agent.md`의 5개 섹션 중 1개만 top-10에 포함).
- **2022년 모델**: instruction tuning, contrastive learning 개선, matryoshka representation 등 최신 임베딩 기법이 미적용.
- **짧은 텍스트 최적화**: 원래 paraphrase(문장 유사도) 용도로 학습되어, 500토큰 규모의 긴 청크에서 정보 손실이 발생한다. ddmi의 청킹 단위가 ~500토큰이므로 불리하다.
- **source_precision 저조**: top-10에서 실제 관련 소스의 비율이 20% 수준 (`source_precision` 0.204~0.223). 즉 10개 중 2개만 정답 소스에서 온 청크다.

---

## 5. 개선 후보 모델 비교

### 5.1. BAAI/bge-m3

| 항목 | 값 |
|------|-----|
| 차원 | 1024 |
| 크기 | ~1.3GB |
| MTEB Retrieval | ~68점 |
| transformers.js 호환 | O (Xenova/bge-m3) |
| 다국어 | 100+ 언어 |

**장점**:
- MTEB Retrieval 68점으로 현재 모델(55점) 대비 ~24% 벤치마크 개선
- 1024차원으로 의미 표현력 2.67배 (384 → 1024)
- 100+ 언어 지원, 한국어 성능이 multilingual 모델 중 최상위권
- Dense retrieval + sparse retrieval + multi-vector retrieval 3가지 모드 지원
- Instruction tuning 적용 — 질의에 "Represent this sentence for retrieval:" 같은 prefix를 붙여 검색 특화 임베딩 생성 가능
- transformers.js에서 Xenova/bge-m3로 사용 가능, local-first 원칙 유지
- 무료 (Apache 2.0 라이선스)

**단점**:
- 크기 1.3GB — 첫 실행 시 다운로드 시간 증가 (~2분, 네트워크 상태 의존)
- 메모리 사용량 증가 예상 (현재 ~785MB → ~2GB 추정)
- 인덱싱 속도 3~5배 느려질 수 있음 (12레이어 → 24레이어, 차원 2.67배)
- transformers.js에서의 동작 안정성 별도 검증 필요

### 5.2. intfloat/multilingual-e5-large

| 항목 | 값 |
|------|-----|
| 차원 | 1024 |
| 크기 | ~1.1GB |
| MTEB Retrieval | ~64점 |
| transformers.js 호환 | O (Xenova/multilingual-e5-large) |
| 다국어 | 100+ 언어 |

**장점**:
- E5 시리즈의 instruction-tuned 다국어 버전
- bge-m3보다 약간 가벼움 (1.1GB vs 1.3GB)
- 안정적인 multilingual 성능

**단점**:
- MTEB 기준 bge-m3보다 4점 낮음 (64 vs 68)
- dense retrieval만 지원 (sparse/multi-vector 미지원)
- 한국어 특화 벤치마크에서 bge-m3 대비 열세

### 5.3. Xenova/all-MiniLM-L6-v2 (비교군)

| 항목 | 값 |
|------|-----|
| 차원 | 384 |
| 크기 | ~80MB |
| MTEB Retrieval | ~49점 (영어) |
| transformers.js 호환 | O |
| 다국어 | 영어 전용 |

**장점**:
- 가장 가볍고 빠름 (80MB, ~50ms/청크)
- 영어 전용 프로젝트에서는 괜찮은 성능

**단점**:
- **한국어 성능 치명적**: 영어 대비 40% 이하로 떨어짐 (`embedding-models-comparison.md`)
- ddmi의 타겟 사용자가 한/영 혼합 프로젝트이므로 부적합
- 비교군으로만 의미 있음

### 5.4. Ollama embed (nomic-embed-text)

| 항목 | 값 |
|------|-----|
| 차원 | 768 |
| 크기 | ~270MB (Ollama 모델) |
| MTEB Retrieval | ~62점 |
| transformers.js 호환 | X (Ollama 서버 필요) |
| 다국어 | 영어 중심 |

**장점**:
- 768차원으로 현재 모델보다 의미 표현력 2배
- Ollama 생태계와 통합 가능

**단점**:
- **Ollama 서버 의존**: local-first 원칙 위반. ddmi는 `npm install`만으로 동작해야 한다.
- 영어 중심 모델로 한국어 성능 미검증
- Level 2 의존성이 Level 1 쿼리 경로에 침투하는 구조적 문제

### 5.5. OpenAI text-embedding-3-small

| 항목 | 값 |
|------|-----|
| 차원 | 1536 |
| 크기 | API 전용 |
| MTEB Retrieval | ~62점 |
| transformers.js 호환 | X (API 호출) |
| 다국어 | O |

**장점**:
- 1536차원으로 가장 높은 의미 표현력
- OpenAI 인프라의 안정성

**단점**:
- **유료**: 사용량 비례 과금. ddmi의 "CLI-first, $0" 철학과 충돌
- **네트워크 의존**: 오프라인 사용 불가. Level 1의 핵심 가치인 "로컬 동작"을 깨뜨림
- 실질 MTEB 점수는 bge-m3보다 낮음 (62 vs 68)

### 5.6. 후보 비교 요약

| 모델 | 차원 | 크기 | MTEB | 한국어 | transformers.js | local-first | 비용 |
|------|------|------|------|--------|-----------------|-------------|------|
| **현재** MiniLM-L12-v2 | 384 | 260MB | ~55 | ~85% | O | O | 무료 |
| **bge-m3** | 1024 | 1.3GB | ~68 | ~95%+ | O | O | 무료 |
| multilingual-e5-large | 1024 | 1.1GB | ~64 | ~90% | O | O | 무료 |
| all-MiniLM-L6-v2 | 384 | 80MB | ~49 | ~40% | O | O | 무료 |
| nomic-embed-text | 768 | 270MB | ~62 | 미검증 | X | X | 무료 |
| text-embedding-3-small | 1536 | API | ~62 | O | X | X | 유료 |

---

## 6. 권장안 (Recommendation)

### bge-m3를 권장한다.

**핵심 이유**:

1. **검색 품질**: MTEB Retrieval ~68점으로 현재 모델(~55점) 대비 24% 벤치마크 개선. 1024차원의 의미 표현력은 384차원 대비 근본적으로 다른 수준이다.

2. **한국어 성능**: 100+ 언어를 지원하며, 한국어 retrieval 벤치마크에서 multilingual 모델 중 최상위권. ddmi의 타겟이 한/영 혼합 프로젝트인 만큼 한국어 품질은 제품 차별화 요소다.

3. **local-first 원칙 유지**: transformers.js에서 `Xenova/bge-m3`로 사용 가능. Ollama, API 서버 없이 `npm install`만으로 동작. Level 1의 쿼리 경로가 외부 의존성 없이 유지된다.

4. **무료**: Apache 2.0 라이선스. CLI-first, $0 철학과 완전히 부합.

5. **확장성**: sparse retrieval 모드를 활용하면 Level 0의 BM25와 Level 1의 dense retrieval을 단일 모델에서 처리할 수 있는 가능성이 열린다 (Phase 2 검토 사항).

### 트레이드오프

| 항목 | 현재 (MiniLM-L12-v2) | bge-m3 | 영향 |
|------|----------------------|--------|------|
| 모델 크기 | 260MB | 1.3GB | 첫 다운로드 +1GB |
| 메모리(RSS) | ~785MB | ~2GB (추정) | 저사양 환경 주의 |
| 인덱싱 속도 | ~2초/63파일 | ~6~10초/63파일 (추정) | 3~5배 느림 |
| 벡터 차원 | 384 | 1024 | LanceDB 저장 용량 ~2.67배 |
| 벡터 검색 속도 | 빠름 | 약간 느림 (1024차원) | 쿼리 < 2초 목표 내 예상 |

이 트레이드오프는 감수할 만하다:
- 메모리 2GB는 ddmi 타겟 사용자(개발자, AI 코딩 에이전트 사용자)의 일반적인 개발 환경에서 문제 없는 수준
- 인덱싱은 백그라운드 작업이므로 속도 저하의 체감 영향이 낮음
- 쿼리 속도(사용자 체감 지표)는 벡터 차원보다 LanceDB의 ANN 인덱스 효율에 더 의존하므로 목표 내 유지 가능

---

## 7. 구현 계획

### 7.1. 코드 변경

**변경 파일 목록**:

| 파일 | 변경 내용 |
|------|-----------|
| `.ddmi/config.toml` | `embedding.model` = `"Xenova/bge-m3"` |
| `packages/aimux/src/providers/transformers.ts` | 기본 모델명 변경, instruction prefix 지원 추가 |
| `src/storage/lance.ts` | 차원 변경에 따른 호환성은 자동 처리됨 (테이블 재생성 시) |
| `src/core/embedder.ts` (있다면) | 모델명 기본값 변경 |
| `eval/run_experiment.py` | 모델명 업데이트 |

**config.toml 변경**:

```toml
[embedding]
provider = "transformers"
model = "Xenova/bge-m3"
# 기존: model = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
# English-only: model = "Xenova/all-MiniLM-L6-v2"
```

**transformers.ts instruction prefix 지원**:

bge-m3는 검색 품질을 높이기 위해 질의에 instruction prefix를 붙이는 것을 권장한다:
- 문서 임베딩: prefix 없이 그대로
- 질의 임베딩: `"Represent this sentence for searching relevant passages: "` + 질의

이를 위해 `embedOne()`과 `embed()`에 `isQuery` 옵션을 추가하거나, 별도의 `embedQuery()` 메서드가 필요하다.

### 7.2. 마이그레이션

차원이 384 → 1024로 변경되면 기존 LanceDB 인덱스와 호환되지 않는다.

**마이그레이션 절차**:

1. `.ddmi/vectors.lance/` 디렉토리 삭제 (또는 `ddmi index --rebuild`)
2. 모든 .md 파일 재임베딩 + 재인덱싱
3. ddmi의 설계 원칙: "Semantic Index 삭제 = zero data loss" — 원본 .md 파일에서 언제든 재구축 가능

**사용자 영향**:
- `ddmi index` 한 번 재실행하면 완료
- 기존 인덱스가 있는 경우 자동 감지 후 재인덱싱 권고 메시지 출력 검토

### 7.3. 테스트 계획

| 단계 | 내용 | 성공 기준 |
|------|------|-----------|
| 1. 모델 로딩 | `Xenova/bge-m3` 다운로드 + transformers.js 로딩 | healthCheck() 통과 |
| 2. 차원 확인 | dimensions() === 1024 | 자동 감지 확인 |
| 3. 임베딩 품질 | 동일 eval 코퍼스(63파일)로 인덱싱 | 에러 없이 완료 |
| 4. eval 실행 | `eval/run_experiment.py` 재실행 | composite 비교 |
| 5. 기존 테스트 | `npm test` 전체 통과 | 0 failures |
| 6. 메모리 측정 | 인덱싱 + 쿼리 시 RSS 측정 | < 3GB |
| 7. 속도 측정 | 63파일 인덱싱 시간 | < 60초 |

### 7.4. 메모리 영향 측정

현재 측정값 (paraphrase-multilingual-MiniLM-L12-v2):
- 인덱싱 시 RSS: ~785MB (MVP-0 RETROSPECTIVE 기준)
- 쿼리 시 RSS: 미측정 (목표 < 200MB)

예상값 (bge-m3):
- 모델 로딩: ~1.3GB (quantized 기준)
- 인덱싱 시 RSS: ~2GB (모델 + 청크 버퍼 + LanceDB)
- 쿼리 시 RSS: ~1.5GB (모델 로딩 + 단일 질의 임베딩)

실제 측정은 구현 후 필수.

### 7.5. 인덱싱 속도 영향

현재: 63파일, 441청크, 임베딩 ~2초 (`experiment_results.json` 기준 `embed_time_sec: 1.9`)

bge-m3 예상:
- 레이어 수 2배 (12 → 24)
- 차원 2.67배 (384 → 1024)
- 예상 인덱싱 시간: ~6~10초 (3~5배)
- 500파일/10,000청크 스케일 목표 기준: ~45~150초 (목표: < 5분 이내)

---

## 8. 성공 기준

| 지표 | 현재 | 목표 | 비고 |
|------|------|------|------|
| fact_recall (full 33, approach D) | 0.838 | **0.90+** | 7% 개선 |
| fact_recall (full 33, approach B) | 0.777 | **0.85+** | 10% 개선 |
| source_precision (full 33) | 0.214 | **0.30+** | 40% 개선 — 핵심 지표 |
| composite (full 33, approach D) | 0.687 | **0.75+** | 9% 개선 |
| answer quality (D vs A) | D < A | **D >= A** | 궁극 목표 |
| 메모리 RSS (인덱싱) | ~785MB | **< 3GB** | 허용 범위 |
| 메모리 RSS (쿼리) | 미측정 | **< 2GB** | 허용 범위 |
| 인덱싱 속도 (63파일) | ~2초 | **< 30초** | 15배 이내 |
| 인덱싱 속도 (500파일 목표) | 미측정 | **< 5분** | 스케일 목표 유지 |
| 쿼리 응답 시간 | < 2초 | **< 2초** | 현재 목표 유지 |
| 기존 테스트 | 전체 통과 | **전체 통과** | 회귀 없음 |

### 핵심 성공 조건

**fact_recall 0.65+ 달성**은 이미 현재 모델로도 충족 상태(0.777~0.838)이므로, bge-m3의 진정한 성공 기준은:

1. **source_precision 0.30+**: top-10 결과 중 관련 소스 비율을 20% → 30%로 개선
2. **answer quality에서 D >= A**: 큐레이션된 컨텍스트가 전체 덤프와 동등 이상

---

## 9. 리스크

### 9.1. 메모리 2GB는 저사양 환경에서 문제

- **영향**: 8GB RAM 환경에서 ddmi 인덱싱 + IDE + 브라우저를 동시 실행하면 스왑 발생 가능
- **완화**: config.toml에서 `embedding.model`을 기존 모델로 되돌리는 옵션 유지. 문서화로 최소 사양 명시 (16GB RAM 권장)
- **대안**: quantized 모델 사용 시 메모리 감소 가능 (transformers.js `quantized: true` 옵션)

### 9.2. 모델 다운로드 1.3GB

- **영향**: 첫 실행 시 네트워크 환경에 따라 1~5분 소요. 오프라인 환경에서는 사전 다운로드 필요
- **완화**: `ddmi init` 시 모델 다운로드 진행률 표시. 오프라인 캐시 지원 (`HF_HUB_OFFLINE=1`)
- **참고**: 현재 260MB 다운로드도 ~30초 걸리므로, 사용자 경험 차이는 크지 않을 수 있음

### 9.3. 차원 변경(384 → 1024)으로 기존 인덱스 호환 불가

- **영향**: 업그레이드 시 반드시 재인덱싱 필요. 기존 `.ddmi/vectors.lance/` 사용 불가
- **완화**: ddmi의 설계 원칙 자체가 "인덱스 삭제 = zero data loss". `ddmi index --rebuild` 명령으로 원클릭 재인덱싱. 차원 불일치 감지 + 자동 재인덱싱 프롬프트 구현
- **영향도**: 낮음 (설계상 이미 고려된 시나리오)

### 9.4. transformers.js에서 bge-m3 동작 불안정 가능성

- **영향**: Xenova/bge-m3가 transformers.js에서 정상 동작하지 않을 수 있음 (모델 변환 이슈, ONNX 호환성 등)
- **완화**: 구현 전 PoC(Proof of Concept) 필수 — 단일 스크립트로 모델 로딩 + 임베딩 생성 + 차원 확인 테스트
- **fallback**: PoC 실패 시 `multilingual-e5-large`로 전환 (동일 차원, 유사한 성능)

### 9.5. 인덱싱 속도 저하

- **영향**: 현재 2초 → 예상 6~10초 (63파일 기준). 500파일 스케일에서 5분 목표 초과 가능성
- **완화**: 배치 처리 최적화 (현재 BATCH_SIZE=32 유지), 증분 인덱싱(변경 파일만) 활용, watcher의 debounce_ms 조정
- **수용 기준**: 500파일 < 5분이면 수용, 초과 시 배치 병렬화 검토

---

## 10. 대안 (불채택)

### 10.1. Ollama embed (nomic-embed-text) — 불채택

- **불채택 이유**: Ollama 서버 의존으로 local-first 원칙 위반. `context_assemble`의 쿼리 경로에 외부 프로세스 의존성이 들어가면, Level 1의 핵심 가치("npm install만으로 동작")가 무너진다. ddmi의 3단계 Graceful Degradation 설계에서 Level 2 의존성이 Level 1에 침투하는 구조적 결함.

### 10.2. OpenAI text-embedding-3-small — 불채택

- **불채택 이유**: 유료 API + 네트워크 의존. ddmi의 "CLI-first, $0" 철학과 정면 충돌. 오프라인 사용 불가. 실질 MTEB 점수(~62)도 bge-m3(~68)보다 낮다. API rate limit, latency 이슈도 인덱싱 속도에 악영향.

### 10.3. multilingual-e5-large — 차선

- **불채택 이유**: bge-m3와 동일한 1024차원이지만 MTEB 4점 열세(64 vs 68), sparse retrieval 미지원. bge-m3의 PoC가 실패할 경우 fallback으로 검토.

### 10.4. 현상 유지 — 불채택

- **불채택 이유**: Codex end-to-end 평가에서 큐레이션된 컨텍스트(D)가 전체 덤프(A)보다 answer quality에서 열세인 상태가 유지되면, ddmi의 제품 가치 자체가 성립하지 않는다. source_precision 20%는 "10개 중 8개가 관련 없는 청크"를 의미하며, 이 수준에서는 사용자가 수동 선택을 포기하지 않을 것이다. 임베딩 품질 개선 없이 스코어링/패킹만으로 이 격차를 메울 수 없다.

---

## 부록: 참고 데이터

### A. 현재 eval 결과 요약

**Standalone retrieval** (`hybrid_tuning_2026-03-15.json`):

| metric | B (dense top-K) | D (hybrid) |
|--------|-----------------|------------|
| composite | 0.652 | **0.687** |
| fact_recall | 0.777 | **0.838** |
| source_recall | 0.747 | **0.773** |
| source_precision | 0.209 | **0.214** |

**Codex end-to-end answer quality** (`experiment_results.json`):

| metric | A (전체 덤프) | B (top-K) | D (hybrid) |
|--------|---------------|-----------|------------|
| accuracy | **4.83** | 4.17 | 4.58 |
| specificity | **4.92** | 4.17 | 4.58 |
| hallucination_free | **4.58** | 4.00 | 4.33 |

### B. 실패 케이스 분석

**Q24** (리뷰 에이전트 핵심 항목): `agents/review-agent.md`의 5개 섹션(보안, 성능, 타입 안전성, 에러 핸들링, MDverse 고유 규칙) 중 에러 핸들링 섹션만 top-10에 진입. 나머지 4개 섹션의 similarity score가 0.566 이하로, 질의와의 의미 거리가 너무 멀게 계산됨.

**Q24 top-10 중 expected_source 포함 현황**:
- Approach B: rank 4에 `review-agent.md > 에러 핸들링` 1개만 (similarity 0.566)
- Approach D: rank 7에 `review-agent.md > 에러 핸들링` 1개만 (similarity 0.566)

이는 384차원 모델이 "코드 리뷰 시 확인해야 할 핵심 항목"이라는 질의와 "보안", "성능", "타입 안전성" 같은 개별 섹션 제목 간의 의미적 연결을 포착하지 못하는 전형적인 사례다. 1024차원 모델에서는 이러한 상위 개념-하위 항목 간 관계를 더 잘 포착할 것으로 기대한다.
