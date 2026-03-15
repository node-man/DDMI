# Changelog

## 0.2.0 — MVP-1 (2026-03-15)

AI Provider abstraction + Relation Engine + Audit Trail + Dashboard.

### AI Provider (Week 4)
- CLI-first provider system: Claude, Codex, Gemini CLI + Ollama HTTP
- AITaskQueue with SQLite-persisted queue + MQ pattern worker
- knowledge_query MCP tool (LLM-based Q&A over project docs)
- Graceful Degradation: Level 0 (BM25) → Level 1 (vector) → Level 2 (LLM)
- Rate limiter: 10 calls/min, 100 calls/session hard limit
- AI call logging: .ddmi/ai.log (JSONL with full prompt/response)

### Relation Engine (Week 5)
- 3-level relation extraction: explicit links → embedding similarity → LLM conflict detection
- relations + conflicts SQLite tables
- Curator: 90% direct context + 10% conflict warnings auto-inclusion
- `ddmi index --provider ollama` — inline AI conflict detection

### Audit Trail (Week 6)
- SHA-256 hash chain — tamper detection for all audit fields
- mutate_audited MCP tool: create/patch/replace_section with mandatory rationale + basedOn
- Path traversal protection
- `ddmi audit` CLI + `--verify` chain integrity check

### Dashboard (Week 7)
- Hono + htmx: Health, Conflicts, Audit pages
- REST API: /api/health, /api/conflicts, /api/audit
- `ddmi serve --dashboard-only` for browser access
- `ddmi status` CLI — project health summary
- `npm run dev` — build + dashboard + watcher

### Infrastructure
- config.toml parser (@iarna/toml) — all weights configurable
- Curator unit tests (24 tests)
- Korean keyword matching improvement (compact substring)
- Feature branch workflow (PR #1, #2, #3 with code review)
- Process lifecycle management (spawn + process group + graceful shutdown)

### Stats
- 117 tests (was 59)
- 4 MCP tools (was 2)
- 4 AI providers verified
- 3 PRs reviewed and merged

## 0.1.0 — MVP-0 (2026-03-15)

First working release. End-to-end pipeline from `ddmi init` to Claude Code MCP integration.

### Core
- **Parser**: remark-based MD parsing (frontmatter, headings, links, checklists)
- **Chunker**: section-based chunking (500 tok max, 50 tok min, merge/split)
- **Embedder**: transformers.js (paraphrase-multilingual-MiniLM-L12-v2, 384 dims)
- **Curator**: multi-factor scoring (semantic + keyword + authority + recency) + budget packing
- **Feedback**: context_feedback data collection for future weight auto-tuning

### Storage
- SQLite (better-sqlite3, WAL mode): files, chunks, feedback_log tables
- LanceDB (embedded): vector storage and similarity search

### MCP Server
- stdio transport via @modelcontextprotocol/sdk
- `context_assemble` tool: curated context for agent tasks
- `context_feedback` tool: outcome recording for learning loop

### CLI
- `ddmi init` — project initialization (.ddmi/, config.toml, .mcp.json)
- `ddmi index` — full/incremental indexing pipeline
- `ddmi query` — terminal-based context assembly with --debug
- `ddmi serve` — MCP server with optional --watch for auto-reindex

### Verified
- 59 unit tests passing
- Claude Code MCP integration tested
- 5-file index in 2.8s, query in 39ms
