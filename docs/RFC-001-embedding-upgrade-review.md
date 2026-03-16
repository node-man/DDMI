# RFC-001 Review: 임베딩 업그레이드의 의미와 더 나은 방향

- **대상 문서**: `docs/RFC-001-embedding-upgrade.md`
- **작성일**: 2026-03-16
- **관점**: First Principles Review
- **결론**: 임베딩 업그레이드는 의미가 있지만, `bge-m3를 기본값으로 즉시 교체`하는 결론은 아직 이르다. 우선순위는 `retrieval 구조 개선`과 `embedder bake-off`다.

---

## 1. 요약

RFC-001은 문제의식 자체는 타당하다. 현재 ddmi는 `fact_recall`은 이미 일정 수준에 도달했지만, `source_precision`이 낮고 end-to-end answer quality에서는 여전히 전체 덤프(A)가 큐레이션(D)보다 우세하다. 이 상태에서 임베딩 품질을 개선하려는 시도는 의미가 있다.

다만 본 RFC는 다음 가정을 너무 강하게 전제한다:

1. answer quality 열세의 주범이 임베딩 모델이다.
2. 더 큰 최신 임베딩 모델이면 제품 가치가 근본적으로 개선된다.
3. bge-m3의 장점(sparse, multi-vector 등)이 현재 ddmi 파이프라인에도 곧바로 실질 가치로 연결된다.

이 세 가정은 아직 충분히 입증되지 않았다. 현재 데이터만 보면 더 직접적인 병목은 `후보 확장`, `섹션 coverage`, `패킹 전략`일 가능성이 높다.

따라서 권장 방향은:

- `bge-m3 기본값 교체`: 보류
- `embedder bake-off`: 진행
- `hierarchical retrieval / sibling section expansion`: 우선 진행

---

## 2. Step 1: 기존 통념 드러내기

RFC에 깔린 통념은 대략 이렇다.

1. `context_assemble`이 ddmi의 핵심이므로 임베딩이 거의 전부다.
2. MTEB retrieval 점수 상승은 ddmi answer quality 상승으로 이어진다.
3. 384차원 → 1024차원 증가는 곧바로 사용자 체감 품질 향상으로 이어진다.
4. 현재 source precision 저조는 임베딩 표현력 부족이 주원인이다.
5. 1.3GB 다운로드와 ~2GB RSS는 타겟 사용자에게 충분히 감당 가능하다.

이 중 일부는 맞지만, 전부를 불변 전제로 두면 안 된다.

---

## 3. Step 2: 원자 단위로 분해

ddmi가 실제로 풀어야 하는 문제를 가장 작은 단위로 나누면 다음과 같다.

### 3.1. 입력

- 질문
- 프로젝트 문서 집합
- 청크 단위 문맥

### 3.2. 처리

1. 관련 파일/청크 후보를 찾는다.
2. 후보 중에서 질문에 필요한 근거 묶음을 고른다.
3. 중복을 줄이고 coverage를 높인다.
4. 토큰 예산 안에 담는다.

### 3.3. 출력

- 에이전트가 바로 쓸 수 있는 컨텍스트 번들

### 3.4. 현재 관측된 병목

- `fact_recall`: 이미 0.777~0.838
- `source_precision`: 0.214 수준
- `answer quality`: 여전히 `A > D`

즉, 지금 문제는 “아무것도 못 찾는다”가 아니라:

- 정답 근거를 충분히 넓게 못 모으거나
- 관련 없는 청크가 너무 많이 섞이거나
- 문서/섹션 묶음이 잘린 상태로 패킹된다는 쪽에 가깝다.

---

## 4. Step 3: 가정 깨기

### 가정 1. 임베딩 품질이 곧 제품 품질이다

- 부분적으로만 맞다.
- 임베딩은 품질 상한을 정하지만, 현재 관측된 병목은 precision/coverage 쪽이다.
- 이미 `fact_recall 0.65+`는 충족했다. 즉 “최소한의 사실 회수”는 되고 있다.

분류: **Soft constraint**

### 가정 2. MTEB retrieval 점수 차이는 ddmi 품질 차이로 직결된다

- MTEB는 일반 retrieval benchmark다.
- ddmi의 실제 과제는 “한 파일의 여러 섹션을 적절히 묶고, 문서 구조를 따라 필요한 범위를 확장하는 것”이다.
- 이는 벤치마크 점수만으로 설명되지 않는다.

분류: **Soft constraint**

### 가정 3. bge-m3의 sparse/multi-vector 장점이 현재 구조에 바로 적용된다

- 현재 구현 계획은 사실상 `dense embedder 교체 + query prefix`다.
- sparse/multi-vector는 모델 선택의 잠재 이점일 뿐, 본 RFC의 구현 범위에는 들어있지 않다.

분류: **False premise**

### 가정 4. 현상 유지 불가 = 곧바로 기본 모델 교체

- 아니다.
- “기본 모델 교체”와 “모델 bake-off + retrieval 구조 개선”은 다른 선택지다.
- 현재는 후자가 더 낮은 리스크로 더 많은 정보를 준다.

분류: **False premise**

### 가정 5. 2GB급 모델도 onboarding friction을 크게 해치지 않는다

- 개발자 장비에선 가능할 수 있다.
- 그러나 ddmi는 로컬 우선 도구다. 초기 다운로드/메모리/콜드 스타트는 실제 채택 장벽이다.

분류: **Soft constraint**

---

## 5. Step 4: 바꿀 수 없는 핵심

가정을 걷어내고 남는 핵심은 이렇다.

1. ddmi는 로컬 우선이어야 한다.
2. 핵심 쿼리 경로는 LLM 없이 작동해야 한다.
3. 한/영 혼합 문서 환경을 지원해야 한다.
4. 전체 덤프보다 훨씬 적은 토큰으로도 충분히 좋은 근거 묶음을 만들어야 한다.

이 제약 아래에서 진짜 문제를 다시 정의하면:

> “더 큰 임베딩을 쓰는 것”이 아니라,
> “질문에 필요한 근거 묶음을 로컬에서 더 정확하게 회수하고 패킹하는 것”이 문제다.

---

## 6. Step 5: 새 해법 설계

### 안 1. Hierarchical Retrieval 먼저

핵심 아이디어:
- 청크를 하나씩만 고르는 대신, 파일 레벨 hit가 나오면 같은 문서의 sibling section을 coverage-aware하게 확장한다.
- 예: `review-agent.md`에서 하나의 관련 섹션이 잡히면, 같은 문서의 인접/형제 섹션을 제한적으로 같이 포함한다.

왜 가능한가:
- ddmi는 이미 파일/섹션 구조를 가지고 있다.
- 추가 인프라 없이 retrieval policy만 바꾸면 된다.

깨는 가정:
- “더 좋은 임베딩이 먼저”라는 가정

기대 개선:
- Q24류 실패 감소
- source precision과 answer quality 동시 개선 가능

### 안 2. Embedder Bake-off

핵심 아이디어:
- `current / bge-m3 / multilingual-e5-large`를 같은 파이프라인에서 비교한다.
- 정책 변경이 아니라 실험으로 다룬다.

왜 가능한가:
- config 기반 모델 전환과 동일 eval harness가 이미 있다.

깨는 가정:
- “bge-m3가 사실상 이미 정답”이라는 가정

기대 개선:
- 더 정확한 투자 판단
- default/fallback 전략을 데이터로 결정

### 안 3. Dual-tier 전략

핵심 아이디어:
- 기본값은 현재처럼 가벼운 모델 유지
- `high-accuracy` 프로필에서 bge-m3 제공

왜 가능한가:
- local-first를 유지하면서도 사용자 환경 차이를 수용할 수 있다.

깨는 가정:
- “모든 사용자에게 하나의 기본 모델” 가정

기대 개선:
- 온보딩 마찰 감소
- 고사양 사용자에게는 더 높은 ceiling 제공

### 비교

가장 추천하는 방향은 `안 1 + 안 2`다.

- `hierarchical retrieval`로 현재 구조 병목을 먼저 겨냥
- 그 위에서 `embedder bake-off`로 실제 모델 교체 가치 검증

`bge-m3`는 “즉시 기본값”이 아니라 “유력한 후보”로 두는 것이 맞다.

---

## 7. Step 6: 가장 작은 실험

### 목표

“임베딩 교체 없이도 precision/answer quality를 더 올릴 수 있는가”와
“모델 교체가 정말 구조 개선보다 큰 효과를 내는가”를 분리해서 검증한다.

### 1주 실험 패키지

1. `hierarchical retrieval` 추가
   - 파일 hit가 나온 경우 sibling section을 제한적으로 확장
   - 최대 추가 토큰/섹션 수 제한

2. embedder 3종 비교
   - current
   - bge-m3
   - multilingual-e5-large

3. 동일 질문셋으로 재측정
   - source_precision
   - fact_recall
   - answer quality
   - RSS
   - cold start 시간

### 성공 기준

- `source_precision >= 0.30`
- `D`가 `A`에 유의미하게 근접하거나 특정 작업군에서 역전
- 고사양 모델의 비용 증가가 실질 개선으로 설명 가능

### Day 1 Action

내일 바로 할 일:

1. `review-agent.md` 같은 다중 섹션 문서를 위한 sibling expansion 실험 추가
2. 동일 eval을 current 모델로 다시 실행
3. 그 다음에만 bge-m3 bake-off 착수

---

## 8. 최종 판단

### 의미 있는가?

의미는 있다.

- 현재 retrieval ceiling을 높이기 위한 유력 후보인 것은 맞다.
- 특히 한국어/다국어 환경과 local-first 조건을 동시에 만족하는 후보가 많지 않다.

### 지금 RFC 결론대로 가도 되는가?

아직 아니다.

- `기본 모델 즉시 교체`는 과하다.
- 현재 데이터는 “임베딩이 주병목”보다는 “retrieval 구조와 coverage 전략”이 더 앞선 병목일 가능성을 보여준다.

### 더 나은 방향은 무엇인가?

가장 좋은 방향은:

1. retrieval 구조 개선 먼저
2. embedder bake-off 병행
3. 충분한 개선이 확인되면 그때 기본값 교체 검토

즉, 이 RFC는 다음처럼 바뀌는 게 더 맞다:

> `RFC-001: bge-m3를 기본값으로 채택한다`
> 가 아니라
> `RFC-001: retrieval 구조 개선과 함께 차세대 임베딩 모델을 bake-off로 검증한다`

---

## 핵심 인사이트

1. 가장 큰 숨은 가정은 “answer quality 열세의 주범이 임베딩 하나”라는 점이다.
2. 가장 유망한 새 접근은 `hierarchical retrieval + embedder bake-off`다.
3. 바로 해야 할 일은 `bge-m3 기본값 교체`가 아니라 Q24류 실패를 줄이는 section expansion 실험이다.
