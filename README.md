# ddmi

**Document-Driven Memory Infrastructure**

> Drift monitor & integrity layer that ensures AI agents never contradict your project's past decisions.

## What is ddmi?

ddmi indexes your project's `.md` files, scores them by relevance, and serves curated context to AI agents via [MCP](https://modelcontextprotocol.io/). It detects contradictions between documents, maintains an immutable audit trail of all changes, and learns from feedback to improve over time.

**It is NOT** an editor or a format converter. It IS your project's knowledge integrity layer.

## Quick Start

```bash
# Initialize
cd your-project
npx ddmi init

# Index MD files
ddmi index

# Start MCP server + Dashboard + file watcher
ddmi serve --watch

# Or just the Dashboard
ddmi serve --dashboard-only
```

After `ddmi init`, a `.mcp.json` is created. Restart your AI coding tool and it will auto-connect.

## MCP Tools (4)

| Tool | LLM | Description |
|------|-----|-------------|
| `context_assemble` | 0 calls | Curate relevant context blocks for a task |
| `context_feedback` | 0 calls | Report which context was useful (moat data) |
| `knowledge_query` | 1 call | Natural language Q&A over project docs |
| `mutate_audited` | 0 calls | Create/modify files with mandatory rationale + audit trail |

## CLI Commands

| Command | Description |
|---------|-------------|
| `ddmi init` | Initialize `.ddmi/`, config, `.mcp.json`, detect AI providers |
| `ddmi index` | Index all `.md` files (parse, chunk, embed, store, extract relations) |
| `ddmi index --provider ollama` | Index + AI conflict detection |
| `ddmi index --incremental` | Re-index only changed files |
| `ddmi query "question"` | Query from terminal |
| `ddmi query "question" --debug` | Show scoring details |
| `ddmi serve --watch` | MCP server + Dashboard + auto-reindex |
| `ddmi serve --dashboard-only` | Dashboard only (http://localhost:3000) |
| `ddmi eval` | Evaluate context quality (33 questions) |
| `ddmi eval --sim 0.70 --kw 0.00` | Override scoring weights |
| `ddmi status` | Project health summary |
| `ddmi audit` | View audit trail |
| `ddmi audit --verify` | Verify hash chain integrity |
| `ddmi worker --provider ollama` | Start AI task queue worker |

## Dashboard

```bash
npm run dev    # Build + Dashboard + file watcher
# Open http://localhost:3000
```

3 pages: **Health** (metrics + chain status), **Conflicts** (decision queue), **Audit** (timeline).

## AI Provider Support

| Provider | Type | Priority |
|----------|------|----------|
| Ollama (qwen3.5, llama3, etc.) | HTTP worker (persistent) | 1st (default) |
| Claude CLI | Subprocess (one-shot) | 2nd |
| Codex CLI | Subprocess (one-shot) | 3rd |
| Gemini CLI | Subprocess (one-shot) | 4th |

Configure in `.ddmi/config.toml`:
```toml
[ai]
default_provider = "auto"  # auto | claude | codex | gemini | ollama
ollama_model = "qwen3.5:9b"
```

## Graceful Degradation

| Level | Requirements | Capabilities |
|-------|-------------|--------------|
| 0 | None (offline) | BM25 keyword search + explicit links |
| 1 | transformers.js | + vector similarity search |
| 2 | + LLM provider | + conflict detection, knowledge_query |

## Scoring

| Factor | Weight | Description |
|--------|--------|-------------|
| Semantic similarity | 0.55 | Cosine similarity to query embedding |
| Keyword boost | 0.15 | Exact term matching (Korean compound word support) |
| Task-aware authority | 0.15 | Document type × task type relevance matrix |
| Recency | 0.15 | Newer documents score higher (adaptive) |

Redundancy penalty prevents selecting duplicate information. Budget: 90% direct context, 10% conflict warnings.

## Audit Trail

Every file mutation through `mutate_audited` requires:
- **rationale**: why this change is being made
- **basedOn**: source documents this change references

Changes are logged with SHA-256 hash chain for tamper detection:
```bash
ddmi audit --verify
# Chain valid (42 events verified)
```

## Performance

| Metric | Result |
|--------|--------|
| Index 14 files | 12.9s |
| Query response | 46ms |
| Incremental (no changes) | 0.0s |
| Memory (query) | 822MB (ONNX model ~740MB baseline) |

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | TypeScript / Node.js |
| Embedding | @xenova/transformers (built-in, no API key) |
| Model | paraphrase-multilingual-MiniLM-L12-v2 (384-dim) |
| Vector DB | LanceDB (embedded, no server) |
| Metadata DB | SQLite via better-sqlite3 (WAL mode) |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Dashboard | Hono + htmx |
| MD Parser | unified / remark |

## License

MIT
