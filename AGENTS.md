# ddmi — Agent Instructions

## Identity

ddmi (**Document-Driven Memory Infrastructure**) ensures AI agents never contradict a project's past decisions. It is NOT an editor, visualizer, or search engine.

## Code Style

- TypeScript strict mode (`"strict": true`)
- ESM only (`"type": "module"`, `"module": "NodeNext"`)
- Functional-first. Classes only for stateful managers (e.g., `VectorStore`, `AITaskQueue`)
- Error handling: Result pattern via `neverthrow`. Use `ok()` / `err()` — never throw in core logic. `try-catch` only at IO boundaries
- Comments explain "why", never "what". If you need a "what" comment, rename the variable/function instead
- No `any`. Use `unknown` + type narrowing if type is truly unknown

## Architecture Rules

### Immutability of Source Files
- **NEVER modify original .md files** during indexing or querying
- The `.ddmi/` index is a read-only overlay — deletable and rebuildable with zero data loss
- File mutations happen ONLY through `mutate_audited` (MVP-1), which requires `rationale` + `based_on`

### Query Path = Zero LLM
- `context_assemble` must NEVER call an LLM. The pipeline is: embed query (transformers.js) → vector search (LanceDB) → score (math) → pack (algorithm) → assemble (string)
- LLM calls exist only in: relation extraction, conflict detection, entity extraction (all MVP-1, batch mode)

### Storage Contracts
- **SQLite** (`better-sqlite3`, synchronous API): metadata, relations, audit log, feedback
- **LanceDB** (`@lancedb/lancedb`): vector embeddings only
- Both live under `.ddmi/` directory. WAL mode enabled for SQLite
- Atomic updates: SQLite BEGIN → chunk updates → LanceDB vector updates → COMMIT. ROLLBACK on failure

## Completed Scope (MVP-0 + MVP-1)

### MVP-0 (완료)
- `src/core/parser.ts` — MD parsing (remark + frontmatter + GFM)
- `src/core/chunker.ts` — Section-based chunking (500 tok max, 50 tok min)
- `src/core/embedder.ts` — transformers.js embedding wrapper
- `src/core/curator.ts` — Scoring + budget packing + assembly
- `src/core/feedback.ts` — Feedback collection (stub + SQLite storage)
- `src/storage/sqlite.ts` — SQLite schema + queries
- `src/storage/lance.ts` — LanceDB wrapper (upsert, search, delete)
- `src/mcp/server.ts` — MCP Server (stdio transport)
- `src/mcp/tools/context-assemble.ts` — Main MCP tool
- `src/mcp/tools/context-feedback.ts` — Feedback MCP tool
- `src/cli/main.ts` — CLI entry point (commander)
- `src/cli/init.ts`, `index-cmd.ts`, `serve.ts`, `query.ts`

### MVP-1 (완료)
- **AI Provider 추상화** (4 providers):
  - `src/ai/provider.ts` — AIProvider + EmbeddingProvider interfaces
  - `src/ai/router.ts` — Task-based routing logic
  - `src/ai/providers/cli-subprocess.ts` — Claude Code, Codex, Gemini CLI delegation
  - `src/ai/providers/ollama.ts` — Ollama HTTP API
  - `src/ai/providers/transformers.ts` — Built-in embedding (default)
  - `src/ai/providers/pipe.ts` — Generic stdin/stdout adapter
  - `src/ai/providers/api.ts` — API fallback
  - `src/ai/prompts/` — All prompt templates for AI tasks
  - `src/ai/queue.ts` — AITaskQueue: batch execution, flush logic, concurrency control
- **Relation Engine** (관계 추출 + 충돌 감지):
  - `src/core/relations.ts` — 3단계 관계 추출 (명시적 링크, 임베딩 유사도, LLM 분석)
  - 충돌 감지 + SQLite 큐 worker
- **Audit Trail** (해시 체인 + mutate_audited):
  - `src/core/audit.ts` — SHA-256 해시 체인, append-only 감사 로그
  - `src/mcp/tools/mutate-audited.ts` — 감사 추적 포함 파일 변경 MCP tool
  - `src/cli/audit.ts` — `ddmi audit` CLI
- **Dashboard** (Mission Control):
  - `src/dashboard/` — Hono + htmx (Health, Conflicts, Audit 페이지)
- **Worker**:
  - SQLite 큐 + MQ 패턴 기반 백그라운드 작업 처리
  - `src/cli/worker.ts` — `ddmi worker` CLI
- **Rate Limiter**:
  - AI call JSONL logging + 할당량 관리
- **추가 MCP 도구**:
  - `src/mcp/tools/knowledge-query.ts` — LLM 기반 지식 질의
- **추가 CLI**:
  - `src/cli/status.ts` — `ddmi status`

### External API Safety Rules
- Gemini CLI 할당량 폭주 사고 이후 API Safety Rules 도입
- Rate Limiter로 외부 AI 호출 제어

### Phase 2+ (미구현)
- `src/mcp/tools/shared-memory.ts`
- `src/mcp/tools/event-broadcast.ts`
- Dashboard SSE 실시간 업데이트
- 피드백 기반 가중치 자동 학습

## Testing

- Framework: vitest
- **150 tests** across **19 test files**
- Core functions must be pure (no IO). IO is injected via interfaces
- Test files: `src/**/*.test.ts` (co-located)
- Coverage target: 80%+
- Performance tests: indexing 50 files < 30s, query response < 2s

## Specialized Agents

### Senior Reviewer Agent

When the user explicitly asks for a rigorous senior review, load and follow:

- `docs/agents/SENIOR_REVIEWER_AGENT.md`

Use this agent when the request implies one of these intents:

- "시니어 리뷰어로 봐줘"
- "꼼꼼하게 리뷰해줘"
- "아키텍처 관점까지 포함해서 리뷰"
- "merge 전에 위험요소 점검"
- "strict review" / "senior review"

Behavior requirements when this agent is active:

- Findings first, ordered by severity
- Focus on regressions, architectural boundary violations, missing tests, and contract drift
- Do not give approval without evidence
- Use `Reject / Needs Evidence / Approve` as the final verdict
- Leave the result as an actual PR comment when PR context is available
- If posting is not possible, produce a comment-ready PR review draft instead of stopping at chat-only feedback

### QA Agent

When the user explicitly asks for destructive, adversarial, or stress-oriented QA, use the `/qa` slash command (`.claude/commands/qa.md`).

## Commit Convention

```
feat: new feature
fix: bug fix
refactor: restructure without behavior change
docs: documentation only
test: add/fix tests
chore: build, CI, dependencies
```

## Key Numbers

| Parameter | Value | Source |
|-----------|-------|--------|
| Chunk max tokens | 500 | DDMI.md §3.1.1 |
| Chunk min tokens | 50 | DDMI.md §3.1.1 |
| Token estimation | len(text) / 3 for Korean | DDMI.md §3.1.1 |
| Embedding model | paraphrase-multilingual-MiniLM-L12-v2 | DDMI.md §4.1 |
| Embedding dimensions | 384 | Model spec |
| Default max_tokens (curator) | 8000 | DDMI.md §4.1 |
| Budget: direct chunks | 60% | DDMI.md §3.2 |
| Budget: rationale chunks | 25% | DDMI.md §3.2 |
| Budget: conflict chunks | 10% | DDMI.md §3.2 |
| Budget: meta summary | 5% | DDMI.md §3.2 |
| Scoring w₁ (semantic_sim) | 0.55 (MVP-0, keyword included) | Day 1 experiment V3 |
| Scoring w_keyword | 0.15 | Day 1 experiment V3 |
| Scoring w_taa | 0.15 | Day 1 experiment V3 |
| Scoring w_recency | 0.15 (adaptive) | Day 1 experiment V3 |
| Redundancy penalty factor | 1.5 | Day 1 experiment V3 |
| Redundancy skip threshold | 0.95 | Day 1 experiment V3 |
| SQLite WAL mode | ON | DDMI.md §4.1 |
| File watcher debounce | 2000ms | DDMI.md §4.1 |
