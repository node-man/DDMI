# CLAUDE.md — ddmi Project Instructions

## What is this project?

ddmi (**Document-Driven Memory Infrastructure**) ensures AI agents never contradict your project's past decisions. It tracks document decisions, detects drift/contradictions, assembles optimal context, and learns what's useful over time.

*Tagline: Drift monitor & integrity layer for AI agents.*

**It is NOT**: an editor, a graph visualizer, a format converter, or a search engine.

## Architecture (quick reference)

```
Agent Interface (MCP)  ←→  Core Engine  ←→  Human Supervision (Web UI)
                              │
                         Storage Layer
                    (.md files + SQLite + LanceDB)
```

**Core Engine** has 4 components:
1. **Semantic Index** — parse, chunk, embed .md files
2. **Context Curator** — assemble optimal context for agent tasks (THE core feature)
3. **Relation Engine** — extract relations between chunks, detect conflicts
4. **Audit Trail** — immutable log of all changes with rationale

## Tech stack

- **Runtime**: TypeScript (Node.js)
- **Vector DB**: LanceDB (embedded, no server)
- **Metadata DB**: SQLite (better-sqlite3)
- **Embedding**: @xenova/transformers (built-in, npm install only). Default model: `paraphrase-multilingual-MiniLM-L12-v2` (multilingual, ~260MB)
- **LLM (indexing)**: CLI-first (Ollama → user CLI → user API key). Relation extraction, conflict detection, etc.
- **LLM (analysis)**: CLI-first (user CLI → API → Ollama). Decision Gate analysis. CLI uses their subscription ($0), API uses their key.
- **MD parser**: unified/remark ecosystem
- **MCP**: @modelcontextprotocol/sdk
- **File watcher**: chokidar
- **Dashboard**: Hono + htmx (minimal)
- **Test**: vitest
- **Package manager**: npm

### CRITICAL: CLI-first AI Architecture

ddmi uses a **CLI-first** strategy for LLM tasks. The core query path (`context_assemble`) requires ZERO LLM calls — it's pure embedding + vector search + scoring algorithms. LLM is only needed for indexing-time tasks (relation extraction, conflict detection) and analysis.

LLM provider priority (auto mode):
1. **CLI** (claude, codex, gemini, llm) → uses their existing subscription, $0 extra
2. **Ollama** → fully local, free
3. **API** (user's own Anthropic/OpenAI key) → always works, paid
4. **None** → LLM features disabled, Level 1 mode (embedding + vector search still works)

The `src/ai/` directory contains all AI abstraction:
- `provider.ts` — AIProvider + EmbeddingProvider interfaces
- `router.ts` — Task-based routing logic
- `providers/cli-subprocess.ts` — Claude Code, Codex, Gemini, llm CLI delegation
- `providers/ollama.ts` — Ollama HTTP API
- `providers/transformers.ts` — Built-in embedding (default)
- `providers/pipe.ts` — Generic stdin/stdout adapter
- `providers/api.ts` — API fallback
- `prompts/` — All prompt templates for AI tasks

## Key files

- `DDMI.md` — Full project spec (identity, architecture, design, roadmap)
- `src/core/index.ts` — Semantic Index
- `src/core/curator.ts` — Context Curator (most important module)
- `src/core/relations.ts` — Relation Engine
- `src/core/audit.ts` — Audit Trail
- `src/ai/provider.ts` — AIProvider + EmbeddingProvider interfaces (key abstraction)
- `src/ai/router.ts` — Task-based AI provider routing
- `src/ai/queue.ts` — AITaskQueue: batch execution, flush logic, concurrency control
- `src/ai/providers/` — CLI subprocess, Ollama, transformers.js, pipe, API implementations
- `src/ai/prompts/` — All prompt templates for relation extraction, conflict detection, etc.
- `src/mcp/server.ts` — MCP Server entry
- `src/mcp/tools/` — Individual MCP tool implementations
- `src/storage/` — SQLite + LanceDB wrappers

## Code conventions

- TypeScript strict mode
- Functional-first, classes only for stateful managers
- Use Result pattern (neverthrow) for error handling
- Comments explain "why", not "what"
- All file mutations MUST include `rationale` and `based_on` fields
- NEVER auto-modify original .md files — index is a read-only overlay

## Current MVP phase

**BEFORE WRITING ANY CODE**: Run the Day 1 hypothesis validation experiment (see DDMI.md § 8). 3-4 hour Python script comparing 3 approaches: A (full dump) vs B (simple top-K) vs C (scored curation). 30+ eval questions. Do NOT proceed with TypeScript implementation until B > A by 20%+.

MVP is split into two phases:
- **MVP-0 (3 weeks)**: Semantic Index + Context Curator + `context_assemble` + `context_feedback` MCP tools + eval framework + CLI. NO AI Provider abstraction, NO AITaskQueue, NO CLI subprocess, NO knowledge_query. The only AI needed is transformers.js embedding — query path has ZERO LLM calls. `context_feedback` collects usage data from day 1 for scoring weight auto-tuning (moat strategy).
- **MVP-1 (5 weeks after MVP-0)**: AI Provider abstraction + CLI/Ollama/API providers + knowledge_query + Relation Engine + Audit Trail + mutate_audited + Mission Control.
- **Phase 2+**: shared_memory, event_broadcast, Dashboard SSE. Do NOT build these in MVP.

**Target customer**: Developer or small team (2-5) using AI coding agents (Claude Code, Codex) with 100+ MD files in their repo. Their pain: manually selecting which MDs to include in agent context every time, and getting inconsistent results when they miss relevant docs.

Start with MVP-0, Week 1. See `DDMI.md` § 8 for full roadmap.

## Important constraints

1. Original .md files are IMMUTABLE — ddmi only reads them and builds an index on top
2. Every mutation through `mutate_audited` requires rationale + based_on (mandatory audit trail)
3. Semantic Index deletion = zero data loss (rebuild anytime from source .md files)
4. Local-first: no external server required, everything in `.ddmi/` directory
5. Context Curator is the HEART — not search, not visualization, but "what should the agent know right now?"
6. **CLI-FIRST, API SUPPORTED** — LLM features use CLI tools first (claude, codex, gemini), Ollama second, user's API key third. Core query path (`context_assemble`) needs NO LLM at all. Embedding uses built-in transformers.js.
7. Embedding uses `@xenova/transformers` (built into npm package). Default model: `paraphrase-multilingual-MiniLM-L12-v2` for Korean/English mixed projects. English-only projects can switch to `all-MiniLM-L6-v2` in config.toml.
8. LLM tasks go through `AIProvider` interface → routed by `src/ai/router.ts` based on task type and available providers. Each provider implements `healthCheck()`, validated at `ddmi init` time. **This is MVP-1 scope — not MVP-0.**
9. **BATCH-FIRST AI**: Never call CLI subprocess individually per task. Use `AITaskQueue` (`src/ai/queue.ts`) to batch tasks and merge prompts. Individual execution is only for `immediate` priority tasks (conflict_analysis, impact_analysis). **This is MVP-1 scope.**
10. **GRACEFUL DEGRADATION (3 levels)**: Level 0 (offline, no model download) = explicit links + frontmatter + BM25 keyword search. Level 1 (transformers.js only) = + vector similarity. Level 2 (+ Ollama/CLI/API LLM) = + relation extraction, conflict detection. ddmi must work at Level 0.
11. **MVP-0 SCOPE IS MINIMAL**: Only build: parsing, chunking, embedding (transformers.js), scoring, budget packing, context_assemble MCP tool, context_feedback MCP tool (stub + SQLite storage), eval framework, CLI (init/index/query/serve/eval). Do NOT build: AI Provider abstraction, AITaskQueue, CLI subprocess, Ollama provider, API provider, knowledge_query, Relation Engine, Audit Trail, mutate_audited, shared_memory, event_broadcast, or Dashboard.
12. **FEEDBACK LOOP (MOAT)**: `context_feedback` collects outcome data from day 1. `feedback_log` SQLite table stores which blocks were helpful/irrelevant per session. This data enables project-specific scoring weight auto-tuning — the longer a project uses ddmi, the better it gets, creating switching cost. Weight learning is Phase 2, but data collection starts in MVP-0.
12. **SCALE TARGETS (MVP-0)**: 500 MD files / ~10,000 chunks. Full indexing < 5 min. Query response < 2 sec. Memory < 500MB RSS indexing, < 200MB RSS querying.
