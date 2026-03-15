---
title: "MVP-0 회고"
date: "2026-03-15"
type: retrospective
---

# MVP-0 회고

> ddmi (Document-Driven Memory Infrastructure) MVP-0의 전체 과정을 돌아본다.

## 숫자로 보는 MVP-0

| 항목 | 결과 |
|------|------|
| 커밋 | 9개 |
| 소스 코드 | ~2,968줄 (TypeScript) |
| 테스트 | 59개 (전부 통과) |
| 소요 시간 | 약 4시간 (구현), Day 1 실험 별도 |
| 파일 | 27개 (src 15, test 4, docs 3, config 5) |
| 인덱싱 | 6파일 2.8초 |
| 쿼리 응답 | 39ms |
| npm 패키지 | ddmi-0.1.0.tgz (152KB) |

## 무엇을 만들었나

### 핵심 파이프라인

```
ddmi init → ddmi index → ddmi serve --watch
                              ↓
            Agent calls context_assemble (MCP)
                              ↓
            Curated context blocks (39ms)
                              ↓
            Agent calls context_feedback (optional)
```

### 모듈별

| 모듈 | 파일 | 역할 | 테스트 |
|------|------|------|--------|
| Parser | core/parser.ts | remark 기반 MD 파싱 (frontmatter, 헤딩, 링크, 체크리스트) | 15 |
| Chunker | core/chunker.ts | 섹션 기반 청킹 (500tok max, 50tok min, 병합/분할) | 16 |
| Embedder | core/embedder.ts | transformers.js 384차원, 배치, L2 norm | 7 |
| Curator | core/curator.ts | 스코어링 + 예산 패킹 + 조립. LLM 호출 0회 | - |
| Feedback | core/feedback.ts | 피드백 수집 (해자 데이터) | - |
| SQLite | storage/sqlite.ts | files, chunks, feedback_log 테이블 | 14 |
| LanceDB | storage/lance.ts | 벡터 저장/검색/삭제 | 7 |
| MCP Server | mcp/server.ts | stdio transport, 2개 도구 등록 | - |
| CLI | cli/*.ts | init, index, query, serve, eval | - |

## 무엇을 배웠나

### 1. Day 1 실험이 방향을 바꿨다

실험 전: "큐레이션이 곧 가치"
실험 후: "큐레이션은 commodity, 진짜 차별화는 감사 추적 + 충돌 감지 + 피드백 학습"

Codex와 Gemini Agent의 리뷰가 결정적이었다. Codex가 full rerun을 돌렸을 때 내 이전 결론("Context Rot 실증")이 뒤집혔다. **12개 질문, 단일 LLM으로 선언한 결론은 노이즈였다.**

교훈: 실험은 결론을 내리기 위한 것이 아니라, 가정을 드러내기 위한 것이다.

### 2. 이름 짓기가 의외로 어려웠다

kura, cairn, pith, lore, engram, memex — 모두 선점. 특히 opencode-lore와 engram은 사실상 동일 컨셉의 프로젝트.

결국 "의미 있는 단어는 반드시 겹친다"는 교훈을 얻고, ddmi (Document-Driven Memory Infrastructure)라는 약어로 정착. 제품이 이름에 의미를 부여하는 것이지, 이름이 제품을 설명하는 것이 아니다.

### 3. chokidar v4 API 변경

`watch("**/*.md")` 글로브 패턴이 v4에서 동작하지 않음. 디렉토리 감시 + 파일 필터링으로 전환 필요. 문서화되어 있지만 마이그레이션 가이드를 놓치기 쉽다.

### 4. LanceDB가 검색 결과에서 vector를 반환하지 않을 수 있다

curator의 redundancy 계산에서 벡터 간 코사인 유사도를 쓰려 했으나, LanceDB search 결과에 vector 필드가 포함되지 않는 경우가 있었다. query similarity 기반 근사치로 대체.

### 5. eval/corpus가 실제 문서를 오염시켰다

실험용 60+개 MD 파일이 인덱싱에 포함되어, context_assemble이 실험 문서를 실제 문서보다 우선 반환하는 문제. `eval/`을 ignore 패턴에 추가하여 해결.

## 무엇이 잘 됐나

### MVP0-PLAN.md 중심 개발

일별 작업, API 시그니처, 검증 기준을 사전에 정의한 것이 효과적이었다. "다음에 뭘 할지" 고민하는 시간이 0에 가까웠다. 체크리스트를 점검하며 진행하니 빠뜨리는 것도 없었다.

### types.ts 단일 진실원

모든 인터페이스를 하나의 파일에 정의한 것이 모듈 간 일관성을 유지하는 데 효과적이었다.

### 테스트 먼저, 구현 다음

storage → parser → chunker → embedder 순서로 테스트를 먼저 작성하고 구현한 것이 버그를 조기에 잡았다. 특히 chunk ID 충돌, 코드 펜스 감지, 소규모 섹션 병합 로직에서 테스트가 문제를 먼저 발견.

## 무엇이 아쉬운가

### 1. 스코어링 품질이 아직 약하다

`ddmi eval` 결과 composite 0.217. fact_recall 0.542. 현재 인덱스가 5개 파일뿐이라 한계가 있지만, 스코어링 자체의 개선 여지가 크다. 특히:
- DDMI.md가 1,270줄로 거대해서 관련 섹션이 다른 청크에 밀림
- keyword boost의 한국어 토큰화가 공백 기반이라 조사 붙은 단어 매칭 실패

### 2. Curator 테스트 부재

core/curator.ts에 단위 테스트가 없다. 스코어링 로직이 복잡한데 테스트 없이 동작만 확인한 상태. MVP-1에서 반드시 추가해야 함.

### 3. 에러 복구가 불완전

인덱싱 중 에러가 나면 해당 파일을 skip하고 계속하지만, SQLite/LanceDB 간 불일치가 발생할 수 있다. 원자적 업데이트가 테스트에서는 동작하지만, 실제 임베딩 실패 시나리오는 미검증.

### 4. config.toml을 실제로 읽지 않는다

config.toml 파일을 생성하지만, curator가 실제로 이 파일에서 가중치를 로드하지 않는다. DEFAULT_SCORING_WEIGHTS 하드코딩 상태. CLI `--sim`, `--kw` 플래그로 우회 가능하지만, config.toml 연동이 필요.

## MVP-1에서 해야 할 것

### 우선순위 높음
1. Curator 단위 테스트 추가
2. config.toml 파서 + 가중치 로드
3. Relation Engine (명시적 링크 기반, LLM 불필요한 것만 먼저)
4. Audit Trail 기본 구현

### 우선순위 보통
5. AI Provider 추상화 (CLI/Ollama/API)
6. knowledge_query MCP 도구
7. 충돌 감지 (코사인 유사도 > 0.85 후보)

### 검토 필요
- opencode-lore, engram 등 경쟁 프로젝트 대비 차별화 전략 구체화
- "감사 추적 + 충돌 감지"가 실제 사용자 고통인지 검증 (첫 번째 고객 인터뷰)
- npm publish 시점 결정

## 한 줄 요약

> Day 1 실험에서 "큐레이션은 commodity"라는 불편한 진실을 발견했고, 그럼에도 MVP-0를 4시간 만에 end-to-end 완성하여 Claude Code에서 실제로 동작하는 MCP 서버를 만들었다. 다음 과제는 이것이 "사용할 가치가 있는가"를 실제 사용자로 검증하는 것이다.
