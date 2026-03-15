# MVP-0 Implementation Plan

> 3주 내에 `ddmi serve --watch` → Claude Code에서 `context_assemble` 호출 → 유용한 컨텍스트 수신을 end-to-end 달성한다.

## 전제 조건

- [x] Day 1 가설 검증 완료 (retrieval 효율 확인, hybrid > top-K 확인)
- [x] 프로젝트 scaffolding (package.json, tsconfig.json)
- [x] `npm install` (의존성 설치)

## Week 1: Semantic Index Core

**목표**: `.md` 파일을 파싱 → 청킹 → 임베딩 → 저장하는 파이프라인 완성

### Day 1-2: Storage Layer

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/storage/sqlite.ts` | SQLite 초기화, 스키마 생성, CRUD | better-sqlite3 |
| `src/storage/lance.ts` | LanceDB 연결, 벡터 upsert/search/delete | @lancedb/lancedb |

**sqlite.ts 핵심 API:**
```typescript
initDatabase(dbPath: string): Database
upsertFile(db, file: FileRecord): void
upsertChunks(db, chunks: ChunkRecord[]): void
deleteFileChunks(db, fileId: string): void
getFileByPath(db, path: string): FileRecord | null
getChunksByFileId(db, fileId: string): ChunkRecord[]
saveFeedback(db, feedback: FeedbackRecord): void
```

**lance.ts 핵심 API:**
```typescript
initVectorStore(dbPath: string): Promise<LanceConnection>
upsertVectors(conn, vectors: VectorRecord[]): Promise<void>
searchSimilar(conn, queryVec: number[], limit: number): Promise<SearchResult[]>
deleteByFileId(conn, fileId: string): Promise<void>
```

**MVP-0 SQLite 테이블:** `files`, `chunks`, `feedback_log` (3개만)
- `relations`, `conflicts`, `audit_log`, `agent_state`는 MVP-1

**검증:**
- [x] SQLite: 파일/청크 CRUD 단위 테스트 (14 tests)
- [x] LanceDB: 벡터 저장 → 검색 → top-K 반환 테스트 (7 tests)
- [x] 원자적 업데이트: SQLite + LanceDB 트랜잭션 테스트

### Day 2-3: Parser + Chunker

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/parser.ts` | MD → AST → 구조화된 데이터 | remark-parse, remark-frontmatter, remark-gfm |
| `src/core/chunker.ts` | AST → 청크 배열 | parser.ts |

**parser.ts 핵심 API:**
```typescript
interface ParsedDocument {
  path: string;
  title: string | null;
  docType: string;           // frontmatter의 type, 없으면 경로에서 추론
  frontmatter: Record<string, unknown>;
  sections: Section[];        // 헤딩 기반 섹션 트리
  links: ExplicitLink[];      // [[wikilink]], [text](path) 추출
  checklistScore: number;     // 0~1, 체크리스트 완성도
}

parseMarkdown(content: string, filePath: string): ParsedDocument
```

**chunker.ts 핵심 API:**
```typescript
interface Chunk {
  id: string;                 // SHA-256(filePath + sectionPath)의 앞 16자
  fileId: string;
  sectionPath: string;        // "## 개요 > ### 배경"
  content: string;
  tokenCount: number;
  headingLevel: number;
  chunkType: 'prose' | 'code' | 'checklist' | 'table';
  metadata: Record<string, unknown>;
}

chunkDocument(doc: ParsedDocument): Chunk[]
estimateTokens(text: string): number  // len / 3 for Korean
```

**청킹 규칙:**
1. `##` 이상 헤딩에서 분할
2. 500토큰 초과 → 문단(`\n\n`) 단위 재분할
3. 50토큰 미만 → 인접 섹션과 병합
4. 코드블록은 포함 섹션에 유지

**검증:**
- [x] frontmatter 있는/없는 파일 파싱 (parser 15 tests)
- [x] 중첩 헤딩 트리 (##, ###, ####)
- [x] 500토큰 초과 섹션 재분할 (chunker 16 tests)
- [x] 50토큰 미만 섹션 병합
- [x] 한국어/영어 혼합 문서

### Day 3-4: Embedder

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/embedder.ts` | 텍스트 → 벡터 변환 | @xenova/transformers |

**핵심 API:**
```typescript
interface Embedder {
  init(): Promise<void>;       // 모델 로드 (첫 실행 시 ~260MB 다운로드)
  embed(texts: string[]): Promise<number[][]>;  // 배치 임베딩
  embedOne(text: string): Promise<number[]>;
  dimensions(): number;        // 384 for multilingual model
}

createEmbedder(modelName?: string): Embedder
```

**구현 주의:**
- 배치 크기 32 (transformers.js 최적)
- L2 normalization 적용
- 모델 다운로드 실패 시 에러 메시지 + graceful exit (Level 0 미구현이므로)
- 임베딩 입력: `${sectionPath}\n${content}` (섹션 경로를 앞에 붙여 컨텍스트 제공)

**검증:**
- [x] 모델 로드 + 단일 텍스트 임베딩 (embedder 7 tests)
- [x] 배치 임베딩 (32개)
- [x] 출력 차원 = 384
- [x] 한국어 텍스트 임베딩 정상 작동 + 코사인 유사도 검증

### Day 4-5: CLI (init + index) + 통합

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/cli/main.ts` | CLI 진입점 | commander |
| `src/cli/init.ts` | `ddmi init` | sqlite.ts |
| `src/cli/index-cmd.ts` | `ddmi index` | parser, chunker, embedder, sqlite, lance |

**`ddmi init` 동작:**
1. `.ddmi/` 디렉토리 생성
2. `.ddmi/config.toml` 기본값 생성
3. `.ddmi/index.db` SQLite 초기화
4. `.gitignore`에 `.ddmi/` 추가 (이미 있으면 skip)
5. 완료 메시지 출력

**`ddmi index` 동작:**
1. 프로젝트 루트에서 `.md` 파일 스캔 (node_modules, .git, .ddmi 제외)
2. 각 파일: checksum 비교 → 변경 시 리인덱싱
3. 파이프라인: 파싱 → 청킹 → 임베딩 → SQLite + LanceDB 저장
4. 진행률 표시
5. 완료 리포트 (파일 수, 청크 수, 소요 시간)

**검증:**
- [x] `ddmi init` → `.ddmi/` + config.toml + index.db + .mcp.json 생성 확인
- [x] `ddmi index` → 69개 MD 파일 인덱싱 7.0초 (목표 30초 이내)
- [x] 증분 인덱싱: `--incremental` → 변경 없으면 69파일 0.0초 (전부 skip)
- [x] 에러 시 나머지 파일 계속 인덱싱 (chunk ID 충돌 수정 후 0 errors)

---

## Week 2: Context Curator + Eval

**목표**: 질의 → 최적 컨텍스트 조립 파이프라인 + 품질 평가 자동화

### Day 6-7: Curator Core

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/curator.ts` | 스코어링 + 패킹 + 조립 | embedder, sqlite, lance |

**핵심 API:**
```typescript
interface ContextRequest {
  intent: string;
  taskType: 'implementation' | 'review' | 'research' | 'planning';
  maxTokens?: number;        // 기본 8000
  exclude?: string[];
}

interface ContextBundle {
  blocks: ContextBlock[];
  metaSummary: string;
  totalTokens: number;
  coverageScore: number;
  feedbackToken: string;     // 피드백 연결용 UUID
  debugScores?: DebugScore[];
}

assembleContext(req: ContextRequest): Promise<ContextBundle>
```

**스코어링 (Day 1 실험 V3 기준):**
```
score = 0.55 * semantic_sim     (코퍼스 적응 시 최대 0.70)
      + 0.15 * keyword_boost    (질의 키워드 리터럴 매칭)
      + 0.15 * task_aware_auth  (doc_type × task_type 매트릭스)
      + 0.15 * recency          (적응형: 날짜 범위 < 30일이면 비활성)
      - 1.5  * redundancy       (유사도 > 0.95 스킵, > 0.85 감점)
```

**Budget packing (greedy):**
- MVP-0: 전체 예산을 "직접 관련" + "메타 요약"으로 사용 (관계 엔진 없으므로)
- 스코어 내림차순으로 예산 채우기
- 파일 다양성 보너스: 새 파일 청크의 redundancy 임계값 완화

### Day 7-8: Feedback + CLI Query

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/feedback.ts` | 피드백 저장 (stub) | sqlite.ts |
| `src/cli/query.ts` | `ddmi query "질문"` | curator.ts |

**feedback.ts — 데이터 수집만, 학습은 Phase 2:**
```typescript
saveFeedback(token: string, input: FeedbackInput): void
getFeedbackStats(): FeedbackStats  // 통계 조회 (디버깅용)
```

### Day 8-9: Eval Framework

| 파일 | 설명 |
|------|------|
| `src/cli/eval.ts` | Day 1 실험의 TypeScript 포팅 |

- questions.json 로드
- A/B/D 비교 자동화 (retrieval-only)
- fact_recall + source_recall + source_precision + composite
- `ddmi eval` / `ddmi eval --question 5`

### Day 10: Week 2 통합 테스트

- [x] `ddmi index` → `ddmi query "질문"` end-to-end (44ms 응답)
- [ ] 스코어링 가중치 변경 → `ddmi eval` 재평가 (eval CLI는 Python으로 대체)
- [x] coverage_score 검증 (0.84 확인)
- [x] debug_scores 출력 검증 (--debug 플래그 동작 확인)
- [x] feedback 저장 확인 (feedback.ts + SQLite 저장 구현 완료)

---

## Week 3: MCP Server + 실사용 검증

**목표**: Claude Code에서 `context_assemble` MCP 호출 → 실제 사용 가능

### Day 11-12: MCP Server

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/mcp/server.ts` | MCP Server 메인 | @modelcontextprotocol/sdk |
| `src/mcp/tools/context-assemble.ts` | context_assemble 도구 | curator.ts |
| `src/mcp/tools/context-feedback.ts` | context_feedback 도구 | feedback.ts |

**context_assemble MCP Tool:**
- input: `{ intent, task_type, max_tokens?, exclude? }`
- output: `{ context_blocks, meta_summary, total_tokens, coverage_score, feedback_token }`

**context_feedback MCP Tool:**
- input: `{ feedback_token, outcome, blocks_used?, blocks_irrelevant?, missing_context? }`
- output: `{ recorded: true, feedback_id }`

### Day 12-13: CLI Serve + File Watcher

| 파일 | 설명 |
|------|------|
| `src/cli/serve.ts` | `ddmi serve [--watch]` |

- `ddmi serve`: MCP stdio 서버 시작
- `ddmi serve --watch`: + chokidar 파일 감시 → 변경 시 자동 리인덱싱
- debounce 2초, ignore: node_modules, .git, .ddmi

**`ddmi init`에서 `.mcp.json` 자동 생성:**
```json
{
  "mcpServers": {
    "ddmi": {
      "command": "ddmi",
      "args": ["serve", "--watch"]
    }
  }
}
```

### Day 13-14: 통합 테스트 + 실사용

- [x] MCP 연동 → context_assemble 호출 → 컨텍스트 수신 (JSON-RPC + Claude Code 실제 연동 모두 성공)
- [x] 실제 프로젝트(이 프로젝트 자체)에서 end-to-end 테스트 (69파일 인덱스 → 517 tokens 큐레이션, coverage 0.95)
- [x] context_feedback 호출 → feedback_log 저장 확인 (FB-20260315-001)
- [x] serve --watch: 파일 변경 → 자동 리인덱싱 확인 (chokidar v4 수정, 0.6초 리인덱스)
- [x] 에러 핸들링: 인덱스 없이 serve 시 안내 메시지
- [x] ~~이슈: eval/corpus 인덱싱 오염~~ → 수정 완료 (eval/ ignore 추가, 5파일만 인덱싱)

### Day 15: 마무리

- [x] README.md 업데이트 (설치, MCP 도구, CLI, 스코어링, 성능)
- [x] npm 패키지 준비 (npm pack → ddmi-0.1.0.tgz, 152KB)
- [x] CHANGELOG.md 작성

---

## 검증 기준 요약

| 항목 | 기준 |
|------|------|
| 인덱싱 속도 | 50 MD 파일 < 30초 |
| 쿼리 응답 | context_assemble < 2초 |
| 메모리 | 인덱싱 < 500MB RSS |
| 테스트 커버리지 | 80%+ |
| MCP 연동 | Claude Code에서 context_assemble 호출 성공 |
| 피드백 수집 | feedback_log에 레코드 저장 확인 |

## 의존 관계 그래프

```
storage/sqlite.ts ←── core/parser.ts
        ↑                   ↓
storage/lance.ts     core/chunker.ts
        ↑                   ↓
        ├──────── core/embedder.ts
        ↑
        ├──────── core/curator.ts ←── core/feedback.ts
        ↑                   ↓
        │           mcp/tools/context-assemble.ts
        │           mcp/tools/context-feedback.ts
        │                   ↓
        └──────── mcp/server.ts
                            ↓
                    cli/serve.ts
                    cli/init.ts
                    cli/index-cmd.ts
                    cli/query.ts
```

<!-- watch test 3 -->

<!-- final watch test -->
