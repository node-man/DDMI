# Changelog

## 0.3.0-alpha — Phase 2 + 2.5 (2026-03-16, in progress)

React SPA Dashboard + AI Intelligence + aimux SDK extraction.

### Phase 2: React SPA Dashboard (PR #5)
- **Full React rewrite**: htmx completely removed, replaced with React 19 + Vite 7 + Tailwind 4
- **Drizzle ORM migration**: SQLite access via Drizzle ORM (replaces raw better-sqlite3 in dashboard)
- **Health Dashboard**: ECharts 6 gauges + StatCards + chain integrity badge + warning panel
- **Knowledge Explorer**: FileNavigator + DocumentViewer (react-markdown) + SearchPanel (BM25)
- **Knowledge Graph**: React Flow (@xyflow/react 12) + FileNode + relation edges (color-coded by type) + MiniMap
- **Conflict Studio**: ConflictCard with severity badges + AI analysis + resolve workflow
- **Audit Timeline**: Vertical timeline UI with type/actor filtering
- New REST API endpoints: /api/files, /api/files/:id/chunks, /api/search, /api/graph

### Phase 2.5: Dashboard AI Operations (PR #7, in progress)
- **Settings page**: AI provider status, index control (reindex/incremental), knowledge query panel
- **AI doc classification**: LLM auto-classifies document types during indexing
- **File-level AI relation extraction**: LLM directly infers relations between files (replaces cosine similarity-based approach)
- **dagre auto-layout**: Automatic graph layout for Knowledge Graph (replaces manual force-directed)
- **Conflict detection fixes**: Handle empty/non-array LLM responses, lower similarity threshold (0.85 → 0.75)
- **Dynamic provider resolution**: AI provider and curator resolved per-request (PR #7 fix)
- New REST API endpoints: /api/providers, /api/index, /api/index/status, /api/knowledge-query
- npm scripts: `index`, `index:claude`, `index:fast`, `reindex`, `reindex:claude`, `dev:client`

### aimux SDK (PR #6)
- Extracted AI CLI multiplexer as independent package (`packages/aimux/`)
- AIProvider + EmbeddingProvider interfaces, CLI/Ollama/transformers.js providers
- Router, Rate Limiter, JSONL Logger, extractJSON
- Roadmap: Credential Scheduler, Model Mapping, OpenAI-compatible API server

### Stats
- 150 tests, 19 test files (unchanged — dashboard is integration-tested manually)
- 6 Dashboard pages (was 3 htmx pages)
- 21 React components
- 7 PRs total (4 reviewed and merged, 1 in progress)

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
