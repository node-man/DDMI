# MVP-1 Implementation Plan

> 5주 내에 AI Provider 추상화 + Relation Engine + Audit Trail + mutate_audited + Mission Control을 구축하여, "충돌 감지 → 인간 승인 → 감사 추적" end-to-end 플로우를 달성한다.

## 전제 조건: Sprint 0 (기술 부채 해결, 2~3일)

MVP-0 회고에서 식별된 기술 부채 4건을 Week 4 시작 전에 해결한다.
Sprint 0은 MVP-1의 기반 품질을 보장하는 투자이다.

| # | 부채 | 파일 | 작업 | 우선순위 |
|---|------|------|------|----------|
| D1 | Curator 테스트 부재 | `src/core/curator.test.ts` (신규) | 스코어링, 예산 패킹, redundancy, coverage 단위 테스트 15개+ | 높음 |
| D2 | config.toml 미연동 | `src/core/config.ts` (신규) | TOML 파서 (`@iarna/toml`) + `loadConfig()` → Curator weights 연동 | 높음 |
| D3 | 스코어링 품질 | `src/core/curator.ts` | 한국어 키워드 매칭 개선 (형태소 단위 → 부분 문자열 매칭), 대형 파일 청크 밀림 문제 조사 | 보통 |
| D4 | 에러 복구 불완전 | `src/storage/sqlite.ts`, `src/storage/lance.ts` | SQLite-LanceDB 원자적 업데이트 실패 시나리오 테스트 + 복구 로직 | 보통 |

**검증:**
- [x] `npm test` — curator.test.ts 24개 테스트 전부 통과 (83 total)
- [x] `ddmi init` → `.ddmi/config.toml` 생성 → config.toml의 weights 수정 → `ddmi eval` 시 반영 확인 (0.208 → 0.145)
- [x] 한국어 "캐시전략" 검색 시 "캐시 전략" 포함 청크 매칭 확인 (compact substring matching)
- [x] LanceDB 실패 시 SQLite 기록 안 됨 → 다음 인덱싱에서 재시도 (순서 변경: LanceDB first)

---

## Week 4: AI Provider 추상화 + knowledge_query

**목표**: CLI-first AI 프로바이더 체계를 구축하고, LLM 기반 지식 질의(knowledge_query) MCP 도구를 추가한다.

### Day 1-2: AI Provider 인터페이스 + 라우터

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/ai/provider.ts` | AIProvider + EmbeddingProvider 인터페이스 정의 | - |
| `src/ai/router.ts` | 태스크별 프로바이더 라우팅 로직 | provider.ts, config.ts |
| `src/ai/utils.ts` | `extractJSON()` — CLI 출력에서 JSON 추출 유틸리티 | - |

**provider.ts 핵심 API (types.ts에 추가):**
```typescript
interface AIProvider {
  name: string;
  chat(prompt: string): Promise<string>;
  chatJSON<T>(prompt: string, schema?: object): Promise<T>;
  healthCheck(): Promise<boolean>;
}

interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  dimensions(): number;
  healthCheck(): Promise<boolean>;
}

type AITaskType =
  | "relation_extraction"
  | "conflict_detection"
  | "entity_extraction"
  | "doc_classification"
  | "conflict_analysis"
  | "impact_analysis";

interface AIRouterConfig {
  defaultProvider: string;  // "auto" | "claude" | "ollama" | "api" | ...
  taskOverrides?: Partial<Record<AITaskType, string>>;
}
```

**router.ts 핵심 API:**
```typescript
interface AIRouter {
  getProvider(taskType: AITaskType): AIProvider;
  getEmbeddingProvider(): EmbeddingProvider;
  getAvailableProviders(): string[];
  getDegradationLevel(): 0 | 1 | 2;
}

createRouter(config: AIRouterConfig): Promise<AIRouter>
```

### Day 2-3: Provider 구현 (CLI + Ollama + API)

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/ai/providers/cli-subprocess.ts` | Claude, Codex, Gemini, llm CLI 위임 | provider.ts |
| `src/ai/providers/ollama.ts` | Ollama HTTP API (chat + embedding) | provider.ts |
| `src/ai/providers/api.ts` | Anthropic/OpenAI API 직접 호출 (fallback) | provider.ts |
| `src/ai/providers/pipe.ts` | stdin/stdout 범용 어댑터 | provider.ts |
| `src/ai/providers/transformers.ts` | 기존 embedder.ts를 EmbeddingProvider로 래핑 | provider.ts, core/embedder.ts |

**CLI Subprocess 구현 주의:**
- 긴 프롬프트는 임시 파일(`/tmp/ddmi-prompt-*.txt`)로 전달 (CLI 인자 길이 제한 대응)
- stdin pipe 방식: `cat /tmp/ddmi-prompt-xxx.txt | claude -p --output-format json`
- stdout에서 ANSI 코드, 경고, 진행률 등을 `extractJSON()`으로 필터링
- 각 CLI 도구별 플래그 매핑: claude `-p`, codex `-q`, gemini `prompt`, llm (기본)

### Day 3-4: AITaskQueue + Graceful Degradation

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/ai/queue.ts` | 배치 작업큐 + flush 로직 | provider.ts, router.ts |
| `src/cli/init.ts` (수정) | `ddmi init`에 AI provider 자동 감지 추가 | router.ts |

**queue.ts 핵심 API (types.ts에 추가):**
```typescript
interface AITask {
  id: string;
  type: AITaskType;
  priority: "immediate" | "batch";
  prompt: string;
  context: object;
}

interface AITaskQueue {
  enqueue<T>(task: Omit<AITask, "id">): Promise<T>;
  flush(type?: AITaskType): Promise<void>;
  pending(): number;
}

interface AITaskQueueConfig {
  batchSize: number;       // default 10
  flushIntervalMs: number; // default 3000
  concurrentLimit: number; // default 3
}

createTaskQueue(router: AIRouter, config?: AITaskQueueConfig): AITaskQueue
```

**Graceful Degradation 3단계:**
- Level 0 (오프라인): 명시적 링크 + frontmatter + BM25 키워드 검색. 임베딩 모델 없이 동작.
- Level 1 (transformers.js만): + 벡터 유사도 검색. **현재 MVP-0 수준.**
- Level 2 (+ LLM): + 관계 추출, 충돌 감지, knowledge_query.
- `ddmi init` 시 사용 가능한 수준 자동 감지 → config.toml에 기록.

### Day 4-5: knowledge_query MCP 도구

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/mcp/tools/knowledge-query.ts` | knowledge_query MCP 도구 | curator.ts, router.ts |
| `src/mcp/server.ts` (수정) | knowledge_query 도구 등록 | knowledge-query.ts |

**knowledge_query vs context_assemble 차이 정의:**

| 구분 | context_assemble | knowledge_query |
|------|------------------|-----------------|
| 목적 | Agent 작업용 컨텍스트 블록 조립 | 자연어 질문에 대한 구조화된 답변 |
| LLM 사용 | 0회 (순수 알고리즘) | 1회 (검색 결과를 LLM이 요약/분석) |
| 출력 | ContextBlock[] + metaSummary | answer (자연어) + provenance_chain |
| 용도 | "이 작업에 필요한 배경 지식 줘" | "TTL 정책은 어떻게 결정되었나?" |
| Level 요구 | Level 1+ | Level 2 (LLM 필수) |

**knowledge_query 파이프라인:**
1. 질의 임베딩 → 벡터 검색 (context_assemble과 동일)
2. 상위 청크를 LLM에 전달 → 질문에 대한 답변 생성
3. `depth: "deep"` 시 → provenance_chain: 답변의 근거 → 근거의 근거 추적 (관계 그래프 탐색)

**knowledge_query 핵심 API (types.ts에 추가):**
```typescript
interface KnowledgeQueryInput {
  question: string;
  depth: "shallow" | "deep";
}

interface KnowledgeQueryOutput {
  answer: string;
  answerChunks: ContextBlock[];
  provenanceChain: ProvenanceStep[];  // depth=deep 시
  level: number;                       // 사용된 Degradation Level
}

interface ProvenanceStep {
  content: string;
  source: string;
  relationToPrevious: string;
}
```

### Week 4 검증

- [x] `ddmi init` → AI provider 자동 감지: claude, codex, gemini, ollama:qwen3.5:9b (Level 2)
- [x] 4개 provider 전부 검증 완료 (동일 질문 테스트):
  - cli:claude 7.2s ✓ | cli:codex 5.1s ✓ | cli:gemini 15.8s ✓ | ollama:qwen3.5:9b 61.8s ✓
- [x] healthCheck → `which`만 사용, API 호출 0 (gemini 사고 후 수정)
- [x] `extractJSON()` — ANSI 코드 포함 stdout에서 JSON 정상 추출 (8 tests)
- [x] AITaskQueue — 배치 시스템 구현 (batchSize=10, flush 3초, 동시성 3)
- [x] knowledge_query MCP 호출 → 자연어 답변 + 출처 반환 (Level 2)
- [x] knowledge_query Level 1 환경 → 에러 메시지 ("LLM provider 필요")
- [x] Graceful Degradation 3단계 완전 구현 (Level 0: BM25, Level 1: +벡터, Level 2: +LLM)
- [x] AI 호출 로깅 → .ddmi/ai.log JSONL (prompt/response 전문 포함)
- [x] Rate Limiter — 분당 10회, 세션당 100회 하드 리밋 (5 tests)
- [x] Ollama Docker 감지 — HTTP /api/tags 체크 (which 불가 환경 대응)

### Week 4 사고 기록

- **gemini 할당량 폭주**: healthCheck에서 `gemini prompt` (잘못된 subcommand) → 대화형 모드 진입 → 내부 retry 1300회 → 할당량 전소
- **수정**: healthCheck=which, `-p ""` + stdin, rate limiter, CLAUDE.md 안전 규칙 6개
- **codex 플래그 오류**: `-q` (존재하지 않는 플래그) → `exec -` (올바른 비대화형 모드)

---

## Week 5: Relation Engine + 배치 실행

**목표**: 청크 간 관계를 추출하고 충돌을 감지하는 엔진을 구축한다. ddmi의 경쟁 차별화 핵심 모듈.

### Day 1-2: 명시적 관계 + 유사도 후보

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/relations.ts` | Relation Engine 메인 모듈 | sqlite.ts, lance.ts |
| `src/storage/sqlite.ts` (수정) | `relations`, `conflicts` 테이블 추가 | - |

**SQLite 스키마 추가 (SCHEMA_VERSION = 2):**
```sql
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source_chunk_id TEXT NOT NULL REFERENCES chunks(id),
  target_chunk_id TEXT NOT NULL REFERENCES chunks(id),
  relation_type TEXT NOT NULL,  -- depends_on, derived_from, contradicts, supersedes, references
  confidence REAL DEFAULT 1.0,
  extraction_method TEXT,       -- explicit, embedding, ai
  metadata JSON,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_chunk_id);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  chunk_a_id TEXT NOT NULL REFERENCES chunks(id),
  chunk_b_id TEXT NOT NULL REFERENCES chunks(id),
  severity TEXT NOT NULL,       -- low, medium, high
  description TEXT,
  status TEXT DEFAULT 'open',   -- open, resolved, dismissed
  resolved_by TEXT,
  resolved_at TEXT,
  resolution_note TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);
```

**relations.ts 핵심 API (types.ts에 추가):**
```typescript
interface Relation {
  id: string;
  sourceChunkId: string;
  targetChunkId: string;
  relationType: "depends_on" | "derived_from" | "contradicts" | "supersedes" | "references";
  confidence: number;
  extractionMethod: "explicit" | "embedding" | "ai";
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Conflict {
  id: string;
  chunkAId: string;
  chunkBId: string;
  severity: "low" | "medium" | "high";
  description: string;
  status: "open" | "resolved" | "dismissed";
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  detectedAt: string;
}

interface RelationEngine {
  extractExplicitLinks(fileId: string): Promise<Relation[]>;
  findSimilarPairs(threshold?: number): Promise<Array<{ a: string; b: string; similarity: number }>>;
  extractRelationsAI(pairs: Array<{ a: string; b: string }>): Promise<Relation[]>;
  detectConflicts(pairs: Array<{ a: string; b: string }>): Promise<Conflict[]>;
  getRelationsForChunk(chunkId: string): Relation[];
  getOpenConflicts(): Conflict[];
  resolveConflict(conflictId: string, resolution: { resolvedBy: string; note: string }): void;
}

createRelationEngine(deps: RelationEngineDeps): RelationEngine
```

**명시적 관계 추출:**
1. Parser가 추출한 `ExplicitLink[]` (wikilink, markdown link) 활용
2. 링크 target → 파일 경로 resolve → target 파일의 청크들과 `references` 관계 생성
3. LLM 불필요, Level 0에서도 동작

**임베딩 유사도 후보:**
1. 최근 변경된 청크 vs 기존 전체 청크 (N x M, 전체 N^2 회피)
2. 코사인 유사도 > threshold (기본 0.85, config.toml `[relations] similarity_threshold`)
3. 실제 프로젝트의 유사도 분포 시각화 → threshold 튜닝
4. 후보 쌍을 다음 단계(LLM 기반 관계 추출)에 전달

### Day 2-3: LLM 기반 관계 추출 + 충돌 감지

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/ai/prompts/relation-extraction.ts` | 관계 추출 프롬프트 템플릿 | - |
| `src/ai/prompts/conflict-detection.ts` | 충돌 감지 프롬프트 템플릿 | - |

**관계 추출 프롬프트 (배치용):**
```typescript
function buildRelationExtractionPrompt(pairs: ChunkPair[]): string
// 입력: 청크 쌍 배열 (최대 10쌍/배치)
// 출력 기대: JSON 배열 [{ pair_id, relation_type, confidence, rationale }]
```

**충돌 감지 프롬프트:**
```typescript
function buildConflictDetectionPrompt(pairs: ChunkPair[]): string
// 입력: 동일 주제의 청크 쌍
// 출력 기대: JSON 배열 [{ pair_id, is_conflict, severity, description }]
```

**충돌 감지 전략:**
- high-precision / low-recall 전략으로 시작
- Decision Queue 노이즈 방지: 초기에는 high severity만 표시
- medium/low는 사용자 opt-in (`config.toml [conflicts] min_severity = "high"`)

### Day 3-4: 배치 실행 완성 + 인덱싱 연결

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/ai/queue.ts` (수정) | 배치 프롬프트 병합 로직 완성 | prompts/*.ts |
| `src/cli/index-cmd.ts` (수정) | 인덱싱 후 관계 추출 + 충돌 감지 파이프라인 연결 | relations.ts, queue.ts |

**증분 충돌 감지:**
- 전체 N^2 비교 대신 "최근 변경된 청크 vs 기존 청크"로 범위 한정
- `ddmi index` 완료 → 변경된 파일의 청크 목록 → 유사도 후보 추출 → 배치 LLM → 관계/충돌 저장
- Level 1 환경에서는 명시적 링크 관계만 추출 (LLM 기반 생략)

### Day 5: Curator 연결 + 통합 테스트

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/curator.ts` (수정) | 충돌 자동 포함 로직 + budget 분배 (60/25/10/5) | relations.ts |
| `src/core/relations.test.ts` (신규) | Relation Engine 단위 테스트 | - |

**Curator 변경: 예산 분배 반영**
```
60% — 직접 관련 청크 (기존)
25% — 근거/의존 청크 (관계 그래프에서 1-hop)
10% — 충돌/모순 청크 (open conflicts)
 5% — 메타 요약
```

### Week 5 검증

- [x] 명시적 링크 파싱 → `references` 관계 생성 (3 unit tests)
- [x] 코사인 유사도 > 0.85 후보 쌍 추출 (13파일 인덱싱 → 4 pairs 발견)
- [ ] 인위적으로 5개 모순 삽입 → 감지율 80% 이상 (LLM 충돌 감지는 serve에서 별도 실행, 후순위)
- [ ] 배치 실행이 개별 호출 대비 60%+ 빠른지 (LLM 배치 최적화는 후순위)
- [x] Level 1 환경: 명시적 관계 + 유사도만 추출, LLM 기반 생략 (aiProvider=null → 빈 결과)
- [x] context_assemble 결과에 충돌 청크 자동 포함 (90% direct, 10% conflicts 예산 분배)
- [x] `ddmi index` → 관계 추출 파이프라인 end-to-end (11.4초, 관계 출력 확인)
- [x] relations, conflicts 테이블 CRUD (6 unit tests)

---

## Week 6: Audit Trail + mutate_audited

**목표**: 모든 변경과 결정의 근거를 추적하는 불변 로그 + Agent용 감사 기록 포함 변경 도구. ddmi의 장기 경쟁 차별화 핵심.

### Day 1-2: Audit Trail 모듈

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/core/audit.ts` | Audit Trail — append-only 로그 + 해시 체인 | sqlite.ts |
| `src/storage/sqlite.ts` (수정) | `audit_log` 테이블 추가 | - |

**SQLite 스키마 추가:**
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  actor TEXT,                    -- agent_id or "human"
  target_file TEXT,
  target_chunk_id TEXT,
  details JSON NOT NULL,
  rationale TEXT,
  based_on JSON,                 -- ["decisions/adr-007.md"]
  previous_hash TEXT,            -- 이전 이벤트의 해시 → 체인
  hash TEXT NOT NULL             -- SHA-256(id + event_type + timestamp + details + previous_hash)
);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_target_file ON audit_log(target_file);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
```

**audit.ts 핵심 API (types.ts에 추가):**
```typescript
type AuditEventType =
  | "file_created"
  | "file_modified"
  | "conflict_detected"
  | "conflict_resolved"
  | "decision_made"
  | "context_assembled";

interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  timestamp: string;
  actor: string;
  targetFile?: string;
  targetChunkId?: string;
  details: Record<string, unknown>;
  rationale?: string;
  basedOn?: string[];
  previousHash: string;
  hash: string;
}

interface AuditTrail {
  log(event: Omit<AuditEvent, "id" | "timestamp" | "previousHash" | "hash">): AuditEvent;
  getEvents(filter?: AuditFilter): AuditEvent[];
  getFileHistory(filePath: string): AuditEvent[];
  verifyChain(): { valid: boolean; brokenAt?: string };
  getLatestHash(): string;
}

interface AuditFilter {
  eventType?: AuditEventType;
  targetFile?: string;
  after?: string;
  before?: string;
  limit?: number;
}

createAuditTrail(dbPath: string): AuditTrail
```

**해시 체인 설계:**
- 각 이벤트의 hash = SHA-256(`${id}|${eventType}|${timestamp}|${JSON.stringify(details)}|${previousHash}`)
- 첫 이벤트의 previousHash = `"genesis"`
- `verifyChain()`: 전체 체인 순회하며 해시 재계산 → 불일치 시 tamper 감지

### Day 2-3: mutate_audited MCP 도구

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/mcp/tools/mutate-audited.ts` | mutate_audited MCP 도구 | audit.ts, relations.ts |
| `src/mcp/server.ts` (수정) | mutate_audited 도구 등록 | mutate-audited.ts |

**mutate_audited 핵심 API (types.ts에 추가):**
```typescript
interface MutateAuditedInput {
  action: "create" | "patch" | "replace_section";
  target: string;
  content: string;
  section?: string;
  rationale: string;       // 필수!
  basedOn: string[];       // 필수!
  requireApproval?: boolean;
}

interface MutateAuditedOutput {
  success: boolean;
  newConflicts: Conflict[];
  auditId: string;
  approvalStatus: "auto" | "pending" | "approved";
}
```

**구현 주의:**
- `replace_section` — remark AST로 섹션 시작/끝 줄 번호만 파악 → 원본 문자열 직접 slice (포맷 보존)
- `rationale`과 `basedOn`이 비어있으면 에러 (mandatory audit trail)
- 변경 후 자동 충돌 재검사: 변경된 청크만 대상

### Day 3-4: 충돌 재검사 + CLI

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/cli/audit.ts` (신규) | `ddmi audit` CLI 명령 | audit.ts |
| `src/cli/main.ts` (수정) | audit 명령 등록 | audit.ts |

**`ddmi audit` CLI:**
```bash
ddmi audit                        # 최근 20건
ddmi audit --last 50              # 최근 50건
ddmi audit --file specs/cache.md  # 특정 파일 이력
ddmi audit --type conflict_detected  # 이벤트 유형 필터
ddmi audit --verify               # 해시 체인 무결성 검증
```

### Day 5: 통합 테스트

| 파일 | 설명 |
|------|------|
| `src/core/audit.test.ts` (신규) | Audit Trail 단위 테스트 |

### Week 6 검증

- [x] mutate_audited → create/patch/replace_section 모두 audit_log 자동 기록
- [x] rationale/basedOn 누락 시 에러 반환
- [x] replace_section → 원본 포맷 보존 (헤딩 유지, 빈 줄 보존)
- [ ] 변경 후 자동 충돌 재검사 동작 (후순위 — serve worker가 처리)
- [x] 해시 체인 무결성 검증 통과 + 탬퍼 감지 (9 tests)
- [x] `ddmi audit --verify` → "Chain valid (3 events verified)"
- [x] `ddmi audit --file` → 특정 파일 이력 조회 (테스트 통과)

---

## Week 7: Mission Control v0

**목표**: 충돌 알림 + Decision Gate + Audit Trail 브라우저 UI를 최소 수준으로 구축한다. 기능 핵심에 집중하고, UI 장식을 최소화한다.

### Day 1-2: Hono 웹서버 + API 엔드포인트

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/dashboard/server.ts` | Hono 웹서버 + API 라우팅 | hono |
| `src/dashboard/api/health.ts` | `GET /api/health` — Project Health 메트릭 | sqlite.ts, relations.ts |
| `src/dashboard/api/conflicts.ts` | `GET/POST /api/conflicts` — 충돌 목록 + 해결 | relations.ts, audit.ts |
| `src/dashboard/api/audit.ts` | `GET /api/audit` — Audit Trail 조회 | audit.ts |
| `src/cli/serve.ts` (수정) | Dashboard 통합 (localhost:3000) | dashboard/server.ts |

**API 엔드포인트:**

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 파일 수, 청크 수, 관계 수, 미해결 충돌 수, 체인 무결성 |
| GET | `/api/conflicts` | 미해결 충돌 목록 (severity 필터) |
| POST | `/api/conflicts/:id/resolve` | 충돌 승인/거부/수정지시 |
| GET | `/api/audit` | 감사 로그 (페이지네이션, 필터) |
| GET | `/api/audit/:file` | 특정 파일 이력 |

### Day 3-4: UI 페이지 (htmx)

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/dashboard/pages/index.html` | 메인 대시보드 — Project Health | htmx |
| `src/dashboard/pages/conflicts.html` | Decision Queue — 충돌 카드 + 승인/거부 | htmx |
| `src/dashboard/pages/audit.html` | Audit Trail — 시간순 로그 | htmx |
| `src/dashboard/static/style.css` | 최소 스타일 | - |

**UI 범위 (최소화):**
- htmx로 서버 사이드 렌더링, JavaScript 프레임워크 없음
- 3개 페이지: Health, Conflicts, Audit
- 충돌 카드: severity 색상, 두 청크 내용 diff, 승인/거부 버튼
- Audit: 시간순 로그 테이블, 필터 (이벤트 유형, 파일)
- SSE 실시간 업데이트는 Phase 2로 미룸

### Day 5: ddmi status CLI + 통합

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/cli/status.ts` (신규) | `ddmi status` — 프로젝트 건강도 CLI | sqlite.ts, relations.ts |
| `src/cli/main.ts` (수정) | status 명령 등록 | status.ts |

**`ddmi status` 출력:**
```
ddmi status
  Files:      127 indexed
  Chunks:     1,847
  Relations:  312
  Conflicts:  3 open (2 high, 1 medium)
  Audit:      89 events, chain valid
  Level:      2 (CLI: claude, Embedding: transformers)
  Dashboard:  http://localhost:3000
```

### Week 7 검증

- [x] `ddmi serve --dashboard-only` → Dashboard 접속 (localhost:3000)
- [x] Health API: files=14, chunks=227, chainValid=true
- [x] Conflicts API: 충돌 목록 + POST resolve
- [x] Audit API: 이벤트 목록 + 필터
- [x] HTML 3페이지 렌더링 (Health, Conflicts, Audit)
- [x] `ddmi status` → 14 indexed, 227 chunks, chain valid, 4 pending
- [x] `npm run dev` → build + dashboard + watcher

---

## Week 8: MVP-1 통합 테스트

**목표**: AI Provider + Relation + Audit + Dashboard end-to-end 전체 플로우 검증 + 에러 핸들링 강화 + 문서 업데이트

### Day 1-2: 전체 플로우 통합 테스트

| 파일 | 설명 |
|------|------|
| `src/integration/mvp1-flow.test.ts` (신규) | 전체 E2E 테스트 |

**E2E 시나리오:**
1. `ddmi init` → AI provider 감지
2. `ddmi index` → 인덱싱 + 관계 추출 + 충돌 감지
3. 인위적 모순 파일 추가 → `ddmi index --incremental` → 충돌 감지
4. `context_assemble` → 충돌 청크 자동 포함 확인
5. Dashboard에서 충돌 확인 → 승인
6. `mutate_audited`로 파일 수정 → audit_log 기록
7. `ddmi audit --verify` → 체인 무결성 확인
8. `knowledge_query` → 자연어 답변 + 출처 반환

### Day 3: Decision Gate에서 AI 분석

| 파일 | 설명 | 의존성 |
|------|------|--------|
| `src/ai/prompts/conflict-analysis.ts` | 충돌 분석 + 대안 생성 프롬프트 | - |
| `src/ai/prompts/impact-analysis.ts` | 영향 분석 프롬프트 | - |
| `src/dashboard/api/conflicts.ts` (수정) | 분석 결과 포함 | queue.ts |

- 충돌 카드에 "AI 분석" 버튼 → immediate 모드로 LLM 호출 → 분석 결과 + 대안 표시
- conflict_analysis, impact_analysis는 immediate priority (사람이 대기)

### Day 4: 스케일 검증 + 에러 핸들링

**스케일 테스트 (한국어/영어 혼합 50+ 파일):**
- [ ] 50 파일 인덱싱 → 관계 추출 → 충돌 감지: 전체 < 3분
- [ ] 100 파일 인덱싱 → 증분: 변경 파일당 < 5초
- [ ] context_assemble 응답 < 2초 (관계 포함)
- [ ] 메모리 < 500MB RSS (인덱싱 시)

**에러 핸들링 강화:**
- AI provider 응답 실패 → 재시도 3회 → skip + 경고
- JSON 파싱 실패 → extractJSON 재시도 → skip + 경고
- SQLite/LanceDB 불일치 → 자동 복구 또는 명확한 에러

### Day 5: 문서 업데이트 + 마무리

- [ ] README.md 업데이트 (새 MCP 도구, CLI 명령, Dashboard)
- [ ] CHANGELOG.md 업데이트
- [ ] config.toml 전체 옵션 문서화
- [ ] npm 패키지 버전 0.2.0 준비

### Week 8 검증

- [ ] E2E: 파일 생성 → 충돌 감지 → Dashboard 표시 → 승인 → 파일 수정 → 감사 기록
- [ ] 다국어 스케일 검증 (한/영 혼합 50+ 파일)
- [ ] Graceful Degradation: Level 0/1/2 각각에서 적절한 동작
- [ ] 에러 핸들링: provider 실패, JSON 파싱 실패, 네트워크 에러
- [ ] `npm test` — 모든 테스트 통과

---

## 검증 기준 요약

| 항목 | 기준 |
|------|------|
| AI Provider | CLI/Ollama/API 각각 healthCheck + 간단한 LLM 태스크 성공 |
| Fallback 체인 | CLI 없음 → Ollama → API → Level 1 자동 전환 |
| 배치 실행 | 개별 대비 60%+ 빠름 (10쌍/배치) |
| 충돌 감지 | 인위적 5개 모순 삽입 → 감지율 80%+ (high severity) |
| Audit Trail | 해시 체인 무결성 검증 통과 |
| mutate_audited | rationale + basedOn 필수, 변경 후 자동 충돌 재검사 |
| Dashboard | 충돌 카드 → 승인 → audit_log 기록 |
| knowledge_query | 자연어 답변 + 출처 반환, Level 2 필수 |
| 인덱싱 (50파일) | 관계 추출 포함 < 3분 |
| 쿼리 응답 | context_assemble < 2초 (관계 포함) |
| 메모리 | 인덱싱 < 500MB RSS |
| 테스트 | 80%+ 커버리지 |
| E2E | 파일 생성 → 충돌 감지 → 승인 → 수정 → 감사 기록 |

---

## 의존 관계 그래프

```
                Sprint 0 (기술 부채)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  curator.test.ts   config.ts    sqlite/lance 복구
        │               │
        └───────┬───────┘
                ▼
    ┌── Week 4: AI Provider ──────────────────┐
    │                                          │
    │  ai/provider.ts ◄── ai/router.ts         │
    │       ▲                  ▲               │
    │       │                  │               │
    │  ai/providers/       ai/queue.ts         │
    │  ├─ cli-subprocess.ts    │               │
    │  ├─ ollama.ts            │               │
    │  ├─ api.ts               │               │
    │  ├─ pipe.ts              │               │
    │  └─ transformers.ts      │               │
    │       │                  │               │
    │       └──────┬───────────┘               │
    │              ▼                           │
    │    mcp/tools/knowledge-query.ts          │
    └──────────────┬───────────────────────────┘
                   │
    ┌── Week 5: Relation Engine ──────────────┐
    │              ▼                           │
    │    core/relations.ts                     │
    │       ▲           ▲                      │
    │       │           │                      │
    │  ai/prompts/   ai/queue.ts (수정)        │
    │  ├─ relation-extraction.ts               │
    │  └─ conflict-detection.ts                │
    │       │                                  │
    │       ▼                                  │
    │  curator.ts (수정: 충돌 자동 포함)        │
    └──────────────┬───────────────────────────┘
                   │
    ┌── Week 6: Audit Trail ──────────────────┐
    │              ▼                           │
    │    core/audit.ts                         │
    │       ▲                                  │
    │       │                                  │
    │  mcp/tools/mutate-audited.ts             │
    │       │                                  │
    │  cli/audit.ts                            │
    └──────────────┬───────────────────────────┘
                   │
    ┌── Week 7: Mission Control ──────────────┐
    │              ▼                           │
    │    dashboard/server.ts                   │
    │       ▲                                  │
    │       │                                  │
    │  dashboard/api/*.ts                      │
    │  dashboard/pages/*.html                  │
    │       │                                  │
    │  cli/status.ts                           │
    └──────────────┬───────────────────────────┘
                   │
    ┌── Week 8: 통합 테스트 ──────────────────┐
    │              ▼                           │
    │  integration/mvp1-flow.test.ts           │
    │  ai/prompts/conflict-analysis.ts         │
    │  ai/prompts/impact-analysis.ts           │
    │  문서 업데이트                            │
    └──────────────────────────────────────────┘
```

---

## MVP-1에서 추가되는 파일 목록

### 신규 파일 (24개)

| 디렉토리 | 파일 | Week |
|-----------|------|------|
| `src/core/` | `config.ts` | S0 |
| `src/core/` | `curator.test.ts` | S0 |
| `src/core/` | `relations.ts` | W5 |
| `src/core/` | `relations.test.ts` | W5 |
| `src/core/` | `audit.ts` | W6 |
| `src/core/` | `audit.test.ts` | W6 |
| `src/ai/` | `provider.ts` | W4 |
| `src/ai/` | `router.ts` | W4 |
| `src/ai/` | `queue.ts` | W4 |
| `src/ai/` | `utils.ts` | W4 |
| `src/ai/providers/` | `cli-subprocess.ts` | W4 |
| `src/ai/providers/` | `ollama.ts` | W4 |
| `src/ai/providers/` | `api.ts` | W4 |
| `src/ai/providers/` | `pipe.ts` | W4 |
| `src/ai/providers/` | `transformers.ts` | W4 |
| `src/ai/prompts/` | `relation-extraction.ts` | W5 |
| `src/ai/prompts/` | `conflict-detection.ts` | W5 |
| `src/ai/prompts/` | `conflict-analysis.ts` | W8 |
| `src/ai/prompts/` | `impact-analysis.ts` | W8 |
| `src/mcp/tools/` | `knowledge-query.ts` | W4 |
| `src/mcp/tools/` | `mutate-audited.ts` | W6 |
| `src/dashboard/` | `server.ts` | W7 |
| `src/dashboard/api/` | `health.ts`, `conflicts.ts`, `audit.ts` | W7 |
| `src/dashboard/pages/` | `index.html`, `conflicts.html`, `audit.html` | W7 |
| `src/dashboard/static/` | `style.css` | W7 |
| `src/cli/` | `audit.ts` | W6 |
| `src/cli/` | `status.ts` | W7 |
| `src/integration/` | `mvp1-flow.test.ts` | W8 |

### 수정 파일 (7개)

| 파일 | 변경 내용 | Week |
|------|-----------|------|
| `src/types.ts` | AIProvider, Relation, Conflict, AuditEvent, KnowledgeQuery 인터페이스 추가 | W4-W6 |
| `src/storage/sqlite.ts` | relations, conflicts, audit_log 테이블 + SCHEMA_VERSION 2 | W5-W6 |
| `src/core/curator.ts` | 충돌 자동 포함, 예산 분배 (60/25/10/5) | W5 |
| `src/mcp/server.ts` | knowledge_query, mutate_audited 도구 등록 | W4, W6 |
| `src/cli/init.ts` | AI provider 자동 감지 | W4 |
| `src/cli/index-cmd.ts` | 관계 추출 + 충돌 감지 파이프라인 연결 | W5 |
| `src/cli/serve.ts` | Dashboard 통합 | W7 |
| `src/cli/main.ts` | audit, status 명령 등록 | W6, W7 |

### 추가 npm 의존성

| 패키지 | 용도 | Week |
|--------|------|------|
| `@iarna/toml` | config.toml 파싱 | S0 |
| `hono` | Dashboard 웹서버 | W7 |
| `@hono/node-server` | Hono Node.js 어댑터 | W7 |

---

## 리스크 & 완화

### MVP-0 회고에서 이관된 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| 스코어링 품질 약함 (composite 0.217) | 관계 포함 시 품질이 개선되지 않으면 차별화 실패 | Sprint 0에서 키워드 매칭 개선 + Week 5에서 관계 기반 스코어링 추가 후 eval 재측정 |
| config.toml 미연동 | 사용자가 가중치 튜닝 불가 | Sprint 0에서 해결 (D2) |
| SQLite-LanceDB 불일치 | 인덱스 손상 | Sprint 0에서 실패 시나리오 테스트 + 복구 로직 (D4) |

### 새로 식별된 리스크

| 리스크 | 영향 | 완화 |
|--------|------|------|
| CLI subprocess 환경 의존성 | 사용자 CLI 버전/설정에 따라 동작 불안정 | healthCheck()로 실행 시점 검증 + extractJSON()으로 stdout 노이즈 필터링 + fallback 체인 |
| 충돌 감지 false positive | Decision Queue 노이즈 → 사용자 신뢰 하락 | high-precision/low-recall 전략 + 초기 high severity만 표시 + min_severity 설정 |
| 코사인 유사도 임계값 (0.85) | 너무 높으면 recall 저하, 너무 낮으면 노이즈 | 실제 프로젝트의 유사도 분포 시각화 → 데이터 기반 튜닝 + config.toml 노출 |
| 배치 JSON 파싱 | LLM 출력 포맷 불안정 → 배치 전체 실패 | extractJSON() 유틸리티 + 개별 태스크 단위 fallback + 3회 재시도 |
| Dashboard 보안 | localhost 외부 접근 시 인증 없음 | MVP-1은 localhost 전용, 외부 접근 경고 표시. 인증은 Post-MVP |
| knowledge_query 범위 팽창 | context_assemble과 중복 → 유지보수 부담 | 차이 명확히 정의 (LLM 0회 vs 1회), 공통 검색 로직은 curator에서 재사용 |
| Relation Engine N^2 비교 | 파일 증가 시 인덱싱 시간 폭증 | "최근 변경 vs 기존"으로 범위 한정 → 선형 증가. 전체 재구축 시에만 N^2 (옵션) |
| Week 7 Dashboard 시간 부족 | UI 작업은 예상보다 시간 소요 | htmx 서버 사이드 렌더링으로 프론트엔드 복잡도 최소화, 스타일은 최소한 |

---

## PM 판단 기록

### Sprint 0 배치 결정

Co-Founder의 제안대로 Sprint 0 (2-3일)을 Week 4 시작 전에 배치한다. 근거:
1. Curator 테스트 부재는 Week 5에서 Curator 수정 (충돌 자동 포함) 시 회귀 위험
2. config.toml 미연동은 Week 4에서 AI provider 설정을 config.toml에 추가할 때 기반 필요
3. 기술 부채를 안고 가면 Week 5-6에서 복합 버그 발생 확률 증가

### 차별화 투자 비중

Co-Founder의 "Week 5, 6에 시간 투자, Week 7 최소화" 의견에 동의한다.
- Week 5 (Relation Engine): 5일 full → 충돌 감지 품질이 제품 차별화의 핵심
- Week 6 (Audit Trail): 5일 full → 해시 체인 설계가 장기 신뢰의 기반
- Week 7 (Dashboard): 5일이지만 UI 최소화 → htmx 서버 사이드, 3페이지만, SSE 미룸

### knowledge_query 범위 확정

Co-Founder의 질문에 대한 답: knowledge_query는 "검색 결과를 LLM이 요약/분석"으로 정의한다.
- context_assemble과의 차이: LLM 0회 vs 1회, 블록 반환 vs 자연어 답변
- provenance_chain (depth=deep)은 관계 그래프 탐색이므로 Week 5 Relation Engine 완성 후 가능
- Week 4에서는 shallow만 구현, deep은 Week 5 이후 연결
