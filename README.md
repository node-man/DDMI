# ddmi

**Document-Driven Memory Infrastructure**

> Drift monitor & integrity layer that ensures AI agents never contradict your project's past decisions.

## What is ddmi?

ddmi indexes your project's `.md` files, scores them by relevance, and serves curated context to AI agents via [MCP](https://modelcontextprotocol.io/). Instead of dumping 30K tokens and hoping the agent finds what it needs, ddmi delivers the right 800 tokens.

**It is NOT** an editor, a graph visualizer, or a search engine.

## Quick Start

```bash
# Initialize in your project
cd your-project
npx ddmi init

# Index your MD files
ddmi index

# Start MCP server (Claude Code, Cursor, etc. connect automatically)
ddmi serve --watch
```

After `ddmi init`, a `.mcp.json` is created. Restart your AI coding tool and it will auto-connect.

## How it Works

```
Agent calls context_assemble("implement cache module", "implementation")
  ↓
ddmi: embed query → vector search → score → pack within budget → return
  ↓
Agent receives: 800 tokens of curated context (not 30K full dump)
```

**Zero LLM calls on the query path.** Everything is embedding + vector search + math.

## MCP Tools

### context_assemble

The primary tool. Agent calls this at the start of every task.

```json
{
  "intent": "implement the caching layer",
  "task_type": "implementation",
  "max_tokens": 8000
}
```

Returns curated context blocks with source, relevance score, and coverage metric.

### context_feedback

Optional. Agent calls this after completing a task to report which context was useful.

```json
{
  "feedback_token": "uuid-from-assemble",
  "outcome": "helpful",
  "blocks_used": ["docs/cache-spec.md#TTL-policy"]
}
```

Feedback accumulates over time, enabling project-specific scoring optimization.

## CLI Commands

| Command | Description |
|---------|-------------|
| `ddmi init` | Initialize `.ddmi/` directory, config, and `.mcp.json` |
| `ddmi index` | Index all `.md` files (parse, chunk, embed, store) |
| `ddmi index --incremental` | Re-index only changed files |
| `ddmi query "question"` | Query from the terminal |
| `ddmi query "question" --debug` | Show scoring details |
| `ddmi serve` | Start MCP server (stdio) |
| `ddmi serve --watch` | MCP server + auto-reindex on file changes |

## Scoring

Context blocks are scored by multiple factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Semantic similarity | 0.55 | Cosine similarity to query embedding |
| Keyword boost | 0.15 | Exact term matching (numbers, identifiers) |
| Task-aware authority | 0.15 | Document type x task type relevance matrix |
| Recency | 0.15 | Newer documents score higher (adaptive) |

Redundancy penalty prevents selecting duplicate information.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | TypeScript / Node.js |
| Embedding | @xenova/transformers (built-in, no API key) |
| Model | paraphrase-multilingual-MiniLM-L12-v2 (384-dim) |
| Vector DB | LanceDB (embedded, no server) |
| Metadata DB | SQLite via better-sqlite3 (WAL mode) |
| MCP | @modelcontextprotocol/sdk (stdio) |
| MD Parser | unified / remark |

## Performance

| Metric | Result |
|--------|--------|
| Index 5 files | 2.8s |
| Query response | 39ms |
| Model load | ~1s (cached after first download) |

## License

MIT
