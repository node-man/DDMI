# ddmi

**Document-Driven Memory Infrastructure**

> *Drift monitor & integrity layer that ensures AI agents never contradict your project's past decisions.*

---

## What is ddmi?

ddmi is a project knowledge infrastructure for the multi-agent era. It tracks document decisions, detects contradictions, and assembles optimal context for AI agents — so they don't break what was already decided.

**It is NOT** an editor, a graph visualizer, or a search engine.

## Quick Start

```bash
npx ddmi init
ddmi index
ddmi serve --watch
```

## How it works

```
Agent (Claude Code, Cursor, etc.)
  ↓ MCP call: context_assemble
ddmi Core Engine
  → Parse .md files → Chunk by section → Embed (transformers.js)
  → Score (semantic + keyword + authority) → Pack within token budget
  ↓
Curated context (780 tokens instead of 32K full dump)
  → Less hallucination, same accuracy
```

## Key Features

- **Context Curator** — assembles the right context for each agent task
- **Drift Monitor** — detects when documents contradict each other
- **Audit Trail** — tracks who changed what, why, based on which decision
- **Feedback Loop** — learns which context is useful per project over time
- **Zero API Key** — core query path needs no LLM. Embedding runs locally via transformers.js

## Architecture

```
Agent Interface (MCP)  ←→  Core Engine  ←→  Human Supervision (Web UI)
                              │
                         Storage Layer
                   (.md files + SQLite + LanceDB)
```

All data stays in `.ddmi/` inside your project. Local-first. No server required.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript (Node.js) |
| Vector DB | LanceDB (embedded) |
| Metadata DB | SQLite (better-sqlite3) |
| Embedding | @xenova/transformers (built-in) |
| MCP | @modelcontextprotocol/sdk |
| MD Parser | unified/remark |

## Status

**Pre-MVP** — Day 1 hypothesis validated. MVP-0 implementation starting.

## License

MIT
