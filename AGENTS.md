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

## MVP-0 Scope (What to Build)

Only these modules:
- `src/core/parser.ts` — MD parsing (remark + frontmatter + GFM)
- `src/core/chunker.ts` — Section-based chunking (500 tok max, 50 tok min)
- `src/core/embedder.ts` — transformers.js embedding wrapper
- `src/core/curator.ts` — Scoring + budget packing + assembly
- `src/core/feedback.ts` — Feedback collection (stub + SQLite storage)
- `src/storage/sqlite.ts` — SQLite schema + queries (files, chunks, feedback_log only)
- `src/storage/lance.ts` — LanceDB wrapper (upsert, search, delete)
- `src/mcp/server.ts` — MCP Server (stdio transport)
- `src/mcp/tools/context-assemble.ts` — Main MCP tool
- `src/mcp/tools/context-feedback.ts` — Feedback MCP tool
- `src/cli/main.ts` — CLI entry point (commander)
- `src/cli/init.ts` — `ddmi init`
- `src/cli/index-cmd.ts` — `ddmi index`
- `src/cli/serve.ts` — `ddmi serve`
- `src/cli/query.ts` — `ddmi query`

Do NOT build in MVP-0:
- `src/ai/` (provider, router, queue, providers/*, prompts/*)
- `src/core/relations.ts`
- `src/core/audit.ts`
- `src/core/watcher.ts` (except basic chokidar in `serve --watch`)
- `src/mcp/tools/knowledge-query.ts`
- `src/mcp/tools/mutate-audited.ts`
- `src/mcp/tools/shared-memory.ts`
- `src/mcp/tools/event-broadcast.ts`
- `src/dashboard/`

## Testing

- Framework: vitest
- Core functions must be pure (no IO). IO is injected via interfaces
- Test files: `src/**/*.test.ts` (co-located)
- Coverage target: 80%+
- Performance tests: indexing 50 files < 30s, query response < 2s

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
