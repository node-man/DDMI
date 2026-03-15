# Changelog

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
