#!/usr/bin/env python3
"""
MDverse Day 1 Hypothesis Validation Experiment

Tests: "Curation > Full Dump" hypothesis
Compares 3 approaches:
  A: Full document dump -> LLM
  B: Simple top-K vector similarity -> LLM
  C: Scored curation (similarity + recency + authority + task_alignment) -> LLM

Usage:
  python eval/run_experiment.py                    # Retrieval-only (no LLM)
  python eval/run_experiment.py --full             # Full experiment with LLM
  python eval/run_experiment.py --question 5       # Single question
  python eval/run_experiment.py --full --question 0  # Single question with LLM
"""

import json
import os
import re
import hashlib
import subprocess
import sys
import time
import argparse
import tempfile
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer
import lancedb
import pyarrow as pa

# ─── Configuration ────────────────────────────────────────

DOCS_DIR = Path(__file__).parent.parent / "docs"
RESULTS_DIR = Path(__file__).parent / "results"
QUESTIONS_FILE = Path(__file__).parent / "questions.json"
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
CONTEXT_BUDGET_TOKENS = 8000
TOP_K_INITIAL = 50  # initial retrieval pool
TOP_K_SELECT = 10   # max chunks to select
HYBRID_KEYWORD_WEIGHT = 0.75  # damp keyword rank so dense order remains primary

# ── Scoring V1 (original — for reference) ──
WEIGHTS_V1 = {
    "semantic_sim": 0.45,
    "relation_strength": 0.00,
    "recency": 0.20,
    "authority": 0.18,
    "task_alignment": 0.17,
    "redundancy_penalty": 2.0,
}

# ── Scoring V2 (improved — 2차 가설 재검증) ──
# Key changes:
#   1. semantic_sim 비중 확대 (0.45 → 0.65)
#   2. authority + task_alignment → task_aware_authority (통합, 0.20)
#   3. recency → 코퍼스 적응형 (날짜 범위 좁으면 자동 축소, 0.15)
#   4. 2단계: semantic top-K 사전필터 → 스코어링 재순위
WEIGHTS = {
    "semantic_sim": 0.65,
    "task_aware_authority": 0.20,
    "recency": 0.15,
    "redundancy_penalty": 1.5,
}

# Task-aware authority: doc_type × task_type → 단일 점수
# 기존 authority(고정)와 task_alignment(매트릭스)를 하나로 통합
TASK_AWARE_AUTHORITY = {
    "decision":  {"implementation": 1.0, "review": 0.9, "research": 0.6, "planning": 0.8},
    "spec":      {"implementation": 0.9, "review": 0.8, "research": 0.4, "planning": 0.9},
    "meeting":   {"implementation": 0.4, "review": 0.5, "research": 0.5, "planning": 0.7},
    "research":  {"implementation": 0.3, "review": 0.4, "research": 1.0, "planning": 0.5},
    "sprint":    {"implementation": 0.6, "review": 0.4, "research": 0.2, "planning": 1.0},
    "task":      {"implementation": 0.7, "review": 0.5, "research": 0.2, "planning": 0.6},
    "agent":     {"implementation": 0.5, "review": 0.8, "research": 0.2, "planning": 0.3},
}

# Legacy (V1 compat)
AUTHORITY = {
    "decision": 1.0, "spec": 0.9, "sprint": 0.7,
    "task": 0.6, "meeting": 0.6, "research": 0.5, "agent": 0.5,
}
TASK_ALIGNMENT = {
    "decision":  {"implementation": 1.0, "review": 0.9, "research": 0.7, "planning": 0.8},
    "spec":      {"implementation": 0.9, "review": 0.8, "research": 0.5, "planning": 0.9},
    "meeting":   {"implementation": 0.5, "review": 0.6, "research": 0.4, "planning": 0.7},
    "research":  {"implementation": 0.4, "review": 0.5, "research": 1.0, "planning": 0.6},
    "sprint":    {"implementation": 0.7, "review": 0.5, "research": 0.3, "planning": 1.0},
    "task":      {"implementation": 0.8, "review": 0.6, "research": 0.3, "planning": 0.7},
    "agent":     {"implementation": 0.6, "review": 0.8, "research": 0.3, "planning": 0.5},
}


# ─── Data Model ───────────────────────────────────────────

@dataclass
class MDChunk:
    file_path: str
    section_path: str
    content: str
    doc_type: str
    date: str
    frontmatter: dict
    token_count: int = 0
    chunk_id: str = ""

    def __post_init__(self):
        # Korean text: ~3 chars per token (rough)
        self.token_count = max(1, len(self.content) // 3)
        self.chunk_id = hashlib.md5(
            f"{self.file_path}:{self.section_path}".encode()
        ).hexdigest()[:12]


# ─── Parsing ──────────────────────────────────────────────

def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter. Returns (frontmatter_dict, body)."""
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    try:
        import yaml
        fm = yaml.safe_load(parts[1]) or {}
    except ImportError:
        # Fallback: simple key-value parsing
        fm = {}
        for line in parts[1].strip().split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                fm[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        fm = {}
    return fm, parts[2]


def guess_doc_type(path: str) -> str:
    """Guess document type from file path."""
    for t in ["decision", "spec", "meeting", "research", "sprint", "task", "agent"]:
        if t in path:
            return t
    return "unknown"


def split_by_headings(body: str, file_path: str) -> list[tuple[str, str]]:
    """Split MD body into sections by headings."""
    lines = body.split("\n")
    sections = []
    current_heading = file_path
    current_lines: list[str] = []

    for line in lines:
        if re.match(r"^#{1,4}\s+", line):
            if current_lines:
                sections.append((current_heading, "\n".join(current_lines)))
            current_heading = f"{file_path} > {line.strip().lstrip('#').strip()}"
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_heading, "\n".join(current_lines)))

    # Merge tiny sections (< 30 chars content)
    merged = []
    for path, content in sections:
        stripped = content.strip()
        if merged and len(stripped) < 30:
            prev_path, prev_content = merged[-1]
            merged[-1] = (prev_path, prev_content + "\n" + content)
        else:
            merged.append((path, content))

    return merged


def parse_md_files(docs_dir: Path) -> list[MDChunk]:
    """Parse all MD files into chunks."""
    chunks = []
    for md_file in sorted(docs_dir.rglob("*.md")):
        rel_path = str(md_file.relative_to(docs_dir))
        content = md_file.read_text(encoding="utf-8")

        frontmatter, body = parse_frontmatter(content)
        doc_type = frontmatter.get("type", guess_doc_type(rel_path))
        date = str(frontmatter.get("date", "2026-03-01"))

        sections = split_by_headings(body, rel_path)

        for section_path, section_content in sections:
            if len(section_content.strip()) < 20:
                continue
            chunks.append(MDChunk(
                file_path=rel_path,
                section_path=section_path,
                content=section_content.strip(),
                doc_type=doc_type,
                date=date,
                frontmatter=frontmatter,
            ))
    return chunks


# ─── Embedding + Storage ─────────────────────────────────

def embed_chunks(chunks: list[MDChunk], model: SentenceTransformer) -> np.ndarray:
    """Embed all chunks."""
    texts = [f"{c.section_path}\n{c.content}" for c in chunks]
    return model.encode(texts, show_progress_bar=True, batch_size=32)


def create_lancedb(
    chunks: list[MDChunk], embeddings: np.ndarray, results_dir: Path
) -> "lancedb.table.Table":
    """Store chunks + embeddings in LanceDB."""
    db = lancedb.connect(str(results_dir / "vectors.lance"))

    data = []
    for chunk, emb in zip(chunks, embeddings):
        data.append({
            "id": chunk.chunk_id,
            "vector": emb.tolist(),
            "file_path": chunk.file_path,
            "section_path": chunk.section_path,
            "content": chunk.content,
            "doc_type": chunk.doc_type,
            "date": chunk.date,
            "token_count": chunk.token_count,
        })

    if "chunks" in db.table_names():
        db.drop_table("chunks")
    return db.create_table("chunks", data)


# ─── Three Approaches ────────────────────────────────────

def approach_full_dump(chunks: list[MDChunk]) -> str:
    """Approach A: Concatenate ALL chunks (no budget limit)."""
    parts = []
    for c in chunks:
        parts.append(f"\n--- Source: {c.file_path} > {c.section_path} ---\n{c.content}")
    return "\n".join(parts)


def approach_top_k(
    table, query_emb: np.ndarray, budget: int = CONTEXT_BUDGET_TOKENS
) -> tuple[str, list[dict]]:
    """Approach B: Simple top-K by cosine similarity within budget."""
    results = table.search(query_emb).limit(TOP_K_INITIAL).to_list()

    selected = []
    total_tokens = 0
    for r in results:
        if total_tokens + r["token_count"] > budget:
            continue
        selected.append(r)
        total_tokens += r["token_count"]
        if len(selected) >= TOP_K_SELECT:
            break

    context = ""
    for r in selected:
        sim = 1 - r["_distance"]
        context += f"\n--- Source: {r['file_path']} (sim: {sim:.3f}) ---\n{r['content']}\n"

    return context, selected


def keyword_boost(query: str, content: str, path: str) -> float:
    """BM25-like keyword boost: literal term matches in content, heading, path."""
    # Split query into terms (2+ chars), normalize
    terms = [t.lower() for t in re.split(r'\s+', query) if len(t) >= 2]
    if not terms:
        return 0.0
    target = (content + " " + path).lower()
    matches = 0.0
    for term in terms:
        if term in target:
            matches += 1.0
            # Exact identifiers, filenames, and numeric settings are high-signal in config questions.
            if any(ch.isdigit() for ch in term) or "_" in term or "." in term or "-" in term:
                matches += 0.5
    return matches / len(terms)


def approach_scored(
    table,
    query_emb: np.ndarray,
    task_type: str = "research",
    budget: int = CONTEXT_BUDGET_TOKENS,
    query_text: str = "",
) -> tuple[str, list[dict]]:
    """Approach C (V3): semantic + keyword + task-aware authority + diversity.

    Key insight: semantic similarity alone is strong but misses exact term matches.
    Adding keyword boost captures cases where specific terms (e.g., "리뷰 에이전트",
    "BM25", "LanceDB") should match documents containing those exact terms.
    """
    results = table.search(query_emb).limit(TOP_K_INITIAL).to_list()
    now = datetime(2026, 3, 14)

    # Adaptive recency
    dates = []
    for r in results:
        try:
            dates.append(datetime.strptime(r["date"][:10], "%Y-%m-%d"))
        except (ValueError, TypeError):
            pass
    date_spread = (max(dates) - min(dates)).days if dates else 0
    recency_active = date_spread > 30

    # Weight allocation:
    #   semantic_sim: 0.55 (dominant signal)
    #   keyword:      0.15 (exact term matching — NEW)
    #   task_aware:   0.15 (doc_type × task_type)
    #   recency:      0.15 (if date_spread > 30 days, else redistributed)
    w_sim = 0.55
    w_kw = 0.15
    w_taa = 0.15
    w_rec = 0.15 if recency_active else 0.0
    # Redistribute inactive recency to sim
    w_sim += (0.15 - w_rec)

    for r in results:
        sim = 1 - r["_distance"]

        # Keyword boost
        kw = keyword_boost(
            query_text,
            r["content"],
            f"{r['section_path']} {r['file_path']}",
        ) if query_text else 0.0

        # Recency
        try:
            doc_date = datetime.strptime(r["date"][:10], "%Y-%m-%d")
            days_ago = (now - doc_date).days
            recency = max(0.0, 1.0 - days_ago / 365)
        except (ValueError, TypeError):
            recency = 0.5

        # Task-aware authority
        taa = TASK_AWARE_AUTHORITY.get(r["doc_type"], {}).get(task_type, 0.5)

        score = w_sim * sim + w_kw * kw + w_taa * taa + w_rec * recency

        r["_score"] = score
        r["_sim"] = sim
        r["_kw"] = kw
        r["_taa"] = taa
        r["_recency"] = recency

    results.sort(key=lambda x: x["_score"], reverse=True)

    # Budget packing with file diversity
    selected = []
    selected_vecs = []
    selected_files = set()
    total_tokens = 0

    for r in results:
        if total_tokens + r["token_count"] > budget:
            continue

        if selected_vecs:
            vec = np.array(r["vector"])
            max_sim = max(
                float(np.dot(vec, sv) / (np.linalg.norm(vec) * np.linalg.norm(sv) + 1e-9))
                for sv in selected_vecs
            )
            if max_sim > 0.95:
                continue

            is_new_file = r["file_path"] not in selected_files
            threshold = 0.90 if is_new_file else 0.85
            penalty = max(0, max_sim - threshold) * 1.5
            adjusted = r["_score"] - penalty
        else:
            adjusted = r["_score"]

        r["_adjusted"] = adjusted
        selected.append(r)
        selected_vecs.append(np.array(r["vector"]))
        selected_files.add(r["file_path"])
        total_tokens += r["token_count"]

        if len(selected) >= TOP_K_SELECT:
            break

    context = ""
    for r in selected:
        context += (
            f"\n--- Source: {r['file_path']} "
            f"(score: {r['_score']:.3f}, sim: {r['_sim']:.3f}, "
            f"kw: {r['_kw']:.2f}, taa: {r['_taa']:.2f}) ---\n"
            f"{r['content']}\n"
        )

    return context, selected


# ─── Approach D: Hybrid (dense + keyword) ────────────────

def approach_hybrid(
    table,
    query_emb: np.ndarray,
    query_text: str,
    task_type: str = "research",
    budget: int = CONTEXT_BUDGET_TOKENS,
) -> tuple[str, list[dict]]:
    """Approach D: weighted RRF of dense similarity and keyword matching.

    Reciprocal Rank Fusion combines two ranked lists:
    - Dense: cosine similarity from LanceDB
    - Keyword: BM25-like keyword matching score
    """
    results = table.search(query_emb).limit(TOP_K_INITIAL).to_list()

    # Score with both signals
    for i, r in enumerate(results):
        r["_dense_rank"] = i + 1
        r["_sim"] = 1 - r["_distance"]
        r["_kw"] = keyword_boost(
            query_text,
            r["content"],
            f"{r['section_path']} {r['file_path']}",
        )

    # Keyword ranking
    kw_sorted = sorted(results, key=lambda x: x["_kw"], reverse=True)
    for i, r in enumerate(kw_sorted):
        r["_kw_rank"] = i + 1

    # Weighted RRF: keep dense retrieval primary, use keyword rank as a rerank hint.
    k = 60
    for r in results:
        r["_rrf"] = (
            1.0 / (k + r["_dense_rank"])
            + HYBRID_KEYWORD_WEIGHT * (1.0 / (k + r["_kw_rank"]))
        )

    results.sort(key=lambda x: x["_rrf"], reverse=True)

    # Budget packing with file diversity
    selected = []
    selected_files = set()
    total_tokens = 0

    for r in results:
        if total_tokens + r["token_count"] > budget:
            continue
        selected.append(r)
        selected_files.add(r["file_path"])
        total_tokens += r["token_count"]
        if len(selected) >= TOP_K_SELECT:
            break

    context = ""
    for r in selected:
        context += (
            f"\n--- Source: {r['file_path']} "
            f"(rrf: {r['_rrf']:.4f}, sim: {r['_sim']:.3f}, kw: {r['_kw']:.2f}) ---\n"
            f"{r['content']}\n"
        )
    return context, selected


# ─── Evaluation ───────────────────────────────────────────

def evaluate_fact_recall(selected: list[dict], key_facts: list[str]) -> float:
    """Key facts string matching in selected chunks."""
    if not key_facts:
        return 0.0
    all_content = " ".join(r["content"] for r in selected).lower()
    found = sum(1 for fact in key_facts if fact.lower() in all_content)
    return found / len(key_facts)


def evaluate_source_recall(selected: list[dict], expected_sources: list[str]) -> float:
    """How many expected source files were retrieved (at least one chunk from each)."""
    if not expected_sources:
        return 0.0
    selected_files = set(r["file_path"] for r in selected)
    found = sum(1 for src in expected_sources if src in selected_files)
    return found / len(expected_sources)


def evaluate_source_precision(selected: list[dict], expected_sources: list[str]) -> float:
    """What fraction of selected files are expected sources."""
    if not selected or not expected_sources:
        return 0.0
    selected_files = set(r["file_path"] for r in selected)
    if not selected_files:
        return 0.0
    relevant = sum(1 for f in selected_files if f in expected_sources)
    return relevant / len(selected_files)


def evaluate_composite(
    selected: list[dict], key_facts: list[str], expected_sources: list[str]
) -> dict:
    """Composite retrieval score: fact_recall + source_recall + source_precision."""
    fr = evaluate_fact_recall(selected, key_facts)
    sr = evaluate_source_recall(selected, expected_sources)
    sp = evaluate_source_precision(selected, expected_sources)
    composite = 0.4 * fr + 0.4 * sr + 0.2 * sp
    return {"fact_recall": round(fr, 3), "source_recall": round(sr, 3),
            "source_precision": round(sp, 3), "composite": round(composite, 3)}


def evaluate_full_dump_retrieval(chunks: list[MDChunk], key_facts: list[str]) -> float:
    """Check key facts in full dump (should be ~1.0)."""
    if not key_facts:
        return 0.0
    all_content = " ".join(c.content for c in chunks).lower()
    found = sum(1 for fact in key_facts if fact.lower() in all_content)
    return found / len(key_facts)


# Legacy wrapper
def evaluate_retrieval(selected: list[dict], key_facts: list[str]) -> float:
    return evaluate_fact_recall(selected, key_facts)


def _call_anthropic_api(prompt: str, system: str = "") -> Optional[str]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msgs = [{"role": "user", "content": prompt}]
        kwargs = {"model": "claude-haiku-4-5-20251001", "max_tokens": 1024, "messages": msgs}
        if system:
            kwargs["system"] = system
        resp = client.messages.create(**kwargs)
        return resp.content[0].text
    except Exception as e:
        print(f"    [API error: {e}]")
        return None


def _call_claude_cli(prompt: str, system: str = "") -> Optional[str]:
    full_prompt = f"{system}\n\n{prompt}" if system else prompt
    try:
        result = subprocess.run(
            ["claude", "-p", "--output-format", "text"],
            input=full_prompt,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except FileNotFoundError:
        return None
    except Exception as e:
        print(f"    [Claude CLI error: {e}]")
    return None


def _call_codex_cli(prompt: str, system: str = "") -> Optional[str]:
    full_prompt = f"{system}\n\n{prompt}" if system else prompt
    output_file = None
    try:
        with tempfile.NamedTemporaryFile(prefix="mdverse-codex-", suffix=".txt", delete=False) as tmp:
            output_file = tmp.name
        result = subprocess.run(
            [
                "codex",
                "exec",
                "--skip-git-repo-check",
                "-C",
                str(DOCS_DIR.parent),
                "--output-last-message",
                output_file,
                "-",
            ],
            input=full_prompt,
            capture_output=True,
            text=True,
            timeout=240,
        )
        if result.returncode == 0:
            output_path = Path(output_file)
            if output_path.exists():
                content = output_path.read_text(encoding="utf-8").strip()
                if content:
                    return content
            if result.stdout.strip():
                return result.stdout.strip()
        else:
            stderr = result.stderr.strip() or result.stdout.strip()
            if stderr:
                print(f"    [Codex CLI error: {stderr}]")
    except FileNotFoundError:
        return None
    except Exception as e:
        print(f"    [Codex CLI error: {e}]")
    finally:
        if output_file:
            try:
                Path(output_file).unlink(missing_ok=True)
            except Exception:
                pass
    return None


def call_llm(prompt: str, system: str = "") -> Optional[str]:
    """Call LLM using best available provider."""
    provider = os.environ.get("MDVERSE_LLM_PROVIDER", "auto").lower()
    providers = {
        "anthropic": lambda: _call_anthropic_api(prompt, system),
        "claude": lambda: _call_claude_cli(prompt, system),
        "codex": lambda: _call_codex_cli(prompt, system),
    }

    if provider in providers:
        result = providers[provider]()
        if result:
            return result
        print(f"    [Requested provider unavailable: {provider}]")
        return None

    for name in ["anthropic", "claude", "codex"]:
        result = providers[name]()
        if result:
            return result

    print("    [No LLM available]")
    return None


def evaluate_answer_with_llm(
    question: str, answer: str, key_facts: list[str]
) -> Optional[dict]:
    """Grade answer quality using LLM judge."""
    prompt = f"""다음 질문에 대한 답변의 품질을 평가해주세요.

질문: {question}

답변: {answer}

핵심 사실 (정답에 포함되어야 할 내용):
{json.dumps(key_facts, ensure_ascii=False)}

3가지 기준으로 1~5점 평가 (5=최고). JSON만 응답하세요:
- accuracy: 핵심 사실을 정확히 포함하는가
- specificity: 구체적 수치/이름/설정값을 포함하는가
- hallucination_free: 컨텍스트에 없는 내용을 지어내지 않았는가 (5=환각 없음)

JSON: """

    result = call_llm(prompt)
    if not result:
        return None
    try:
        match = re.search(r"\{[^}]+\}", result)
        if match:
            return json.loads(match.group())
    except (json.JSONDecodeError, AttributeError):
        pass
    return None


# ─── Main Experiment ──────────────────────────────────────

def run_experiment(full_mode: bool = False, single_question: Optional[int] = None,
                   sample_ids: Optional[list[int]] = None):
    print("=" * 60)
    print("MDverse Day 1 Hypothesis Validation")
    print("=" * 60)

    # ── Load questions ──
    with open(QUESTIONS_FILE, encoding="utf-8") as f:
        questions = json.load(f)
    if single_question is not None:
        questions = [questions[single_question]]
    elif sample_ids is not None:
        questions = [questions[i] for i in sample_ids if i < len(questions)]

    # ── Parse MD files ──
    print(f"\n[1/4] Parsing MD files from {DOCS_DIR} ...")
    chunks = parse_md_files(DOCS_DIR)
    n_files = len(set(c.file_path for c in chunks))
    total_tokens = sum(c.token_count for c in chunks)
    print(f"  {n_files} files -> {len(chunks)} chunks ({total_tokens:,} tokens)")

    if len(chunks) < 10:
        print("\n  ERROR: Too few chunks. Ensure docs/ has 50+ MD files.")
        sys.exit(1)

    # ── Embed ──
    print(f"\n[2/4] Embedding with {EMBEDDING_MODEL} ...")
    t0 = time.time()
    model = SentenceTransformer(EMBEDDING_MODEL)
    embeddings = embed_chunks(chunks, model)
    embed_time = time.time() - t0
    print(f"  {len(chunks)} chunks embedded in {embed_time:.1f}s ({embed_time/len(chunks)*1000:.0f}ms/chunk)")

    # ── Store in LanceDB ──
    print(f"\n[3/4] Storing in LanceDB ...")
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    table = create_lancedb(chunks, embeddings, RESULTS_DIR)
    print(f"  Stored {len(chunks)} vectors")

    # ── Run experiment ──
    print(f"\n[4/4] Running experiment ({len(questions)} questions) ...")
    full_dump_text = approach_full_dump(chunks)
    full_dump_tokens = sum(c.token_count for c in chunks)
    print(f"  Full dump: {full_dump_tokens:,} tokens")
    print(f"  Budget (B/C): {CONTEXT_BUDGET_TOKENS:,} tokens")

    results_list = []

    for i, q in enumerate(questions):
        qid = q.get("id", i + 1)
        print(f"\n  Q{qid}: {q['question'][:55]}...")

        query_emb = model.encode(q["question"])
        task_type = q.get("task_type", "research")

        expected_sources = q.get("expected_sources", [])

        # Retrieval: A (full dump always contains everything)
        ret_a = evaluate_full_dump_retrieval(chunks, q["key_facts"])

        # Retrieval: B (top-K)
        ctx_b, sel_b = approach_top_k(table, query_emb)
        eval_b = evaluate_composite(sel_b, q["key_facts"], expected_sources)

        # Retrieval: C (scored)
        ctx_c, sel_c = approach_scored(table, query_emb, task_type, query_text=q["question"])
        eval_c = evaluate_composite(sel_c, q["key_facts"], expected_sources)

        # Retrieval: D (hybrid RRF)
        ctx_d, sel_d = approach_hybrid(table, query_emb, q["question"], task_type)
        eval_d = evaluate_composite(sel_d, q["key_facts"], expected_sources)

        q_result = {
            "id": qid,
            "question": q["question"],
            "category": q.get("category", ""),
            "task_type": task_type,
            "retrieval": {
                "A": round(ret_a, 3),
                "B": eval_b["fact_recall"], "C": eval_c["fact_recall"], "D": eval_d["fact_recall"],
            },
            "composite": {"B": eval_b["composite"], "C": eval_c["composite"], "D": eval_d["composite"]},
            "source_recall": {"B": eval_b["source_recall"], "C": eval_c["source_recall"], "D": eval_d["source_recall"]},
            "source_precision": {"B": eval_b["source_precision"], "C": eval_c["source_precision"], "D": eval_d["source_precision"]},
            "chunks_selected": {"B": len(sel_b), "C": len(sel_c), "D": len(sel_d)},
            "tokens_used": {
                "A": full_dump_tokens,
                "B": sum(r["token_count"] for r in sel_b),
                "C": sum(r["token_count"] for r in sel_c),
                "D": sum(r["token_count"] for r in sel_d),
            },
        }

        print(f"    fact_recall:  B={eval_b['fact_recall']:.2f}  C={eval_c['fact_recall']:.2f}  D={eval_d['fact_recall']:.2f}")
        print(f"    source_recall: B={eval_b['source_recall']:.2f}  C={eval_c['source_recall']:.2f}  D={eval_d['source_recall']:.2f}")
        print(f"    composite:    B={eval_b['composite']:.3f}  C={eval_c['composite']:.3f}  D={eval_d['composite']:.3f}")

        # LLM evaluation (--full mode): A, B, D only (C ≈ B, skip to save cost)
        if full_mode:
            system = (
                "프로젝트 문서를 기반으로 질문에 정확하고 구체적으로 답변하세요. "
                "문서에 없는 내용은 추측하지 마세요. 가능하면 출처 문서명을 인용하세요."
            )

            for label, ctx in [("A", full_dump_text), ("B", ctx_b), ("D", ctx_d)]:
                print(f"    LLM {label}...", end=" ", flush=True)
                prompt = f"프로젝트 문서:\n{ctx}\n\n질문: {q['question']}"
                answer = call_llm(prompt, system)
                if answer:
                    q_result.setdefault("answers", {})[label] = answer
                    scores = evaluate_answer_with_llm(q["question"], answer, q["key_facts"])
                    if scores:
                        q_result.setdefault("llm_scores", {})[label] = scores
                        acc = scores.get("accuracy", 0)
                        spec = scores.get("specificity", 0)
                        hal = scores.get("hallucination_free", 0)
                        print(f"acc={acc} spec={spec} hal={hal}")
                    else:
                        print("eval failed")
                else:
                    print("no answer")

        results_list.append(q_result)

    # ── Summary ──
    print(f"\n{'=' * 60}")
    print("RESULTS SUMMARY")
    print(f"{'=' * 60}")

    n_q = len(results_list)
    approaches = ["B", "C", "D"]

    # Averages
    avg_fr = {k: np.mean([r["retrieval"][k] for r in results_list]) for k in approaches}
    avg_sr = {k: np.mean([r["source_recall"][k] for r in results_list]) for k in approaches}
    avg_sp = {k: np.mean([r["source_precision"][k] for r in results_list]) for k in approaches}
    avg_comp = {k: np.mean([r["composite"][k] for r in results_list]) for k in approaches}
    avg_tok = {k: np.mean([r["tokens_used"][k] for r in results_list]) for k in approaches}
    avg_ret_a = np.mean([r["retrieval"]["A"] for r in results_list])

    print(f"\nCorpus: {n_files} files, {len(chunks)} chunks, {total_tokens:,} tokens")
    print(f"Questions: {n_q}")
    print(f"Embedding time: {embed_time:.1f}s ({embed_time/len(chunks)*1000:.0f}ms/chunk)")

    print(f"\n{'─'*65}")
    print(f"{'':>25} {'B(top-K)':>10} {'C(scored)':>10} {'D(hybrid)':>10}")
    print(f"{'─'*65}")
    print(f"{'fact_recall':>25} {avg_fr['B']:>10.3f} {avg_fr['C']:>10.3f} {avg_fr['D']:>10.3f}")
    print(f"{'source_recall':>25} {avg_sr['B']:>10.3f} {avg_sr['C']:>10.3f} {avg_sr['D']:>10.3f}")
    print(f"{'source_precision':>25} {avg_sp['B']:>10.3f} {avg_sp['C']:>10.3f} {avg_sp['D']:>10.3f}")
    print(f"{'─'*65}")
    print(f"{'COMPOSITE (0.4/0.4/0.2)':>25} {avg_comp['B']:>10.3f} {avg_comp['C']:>10.3f} {avg_comp['D']:>10.3f}")
    print(f"{'avg tokens':>25} {avg_tok['B']:>10.0f} {avg_tok['C']:>10.0f} {avg_tok['D']:>10.0f}")
    print(f"{'─'*65}")
    print(f"\n  A (full dump): fact_recall={avg_ret_a:.3f}, {full_dump_tokens:,} tokens")

    if full_mode:
        print(f"\nLLM Evaluation Scores (1-5):")
        for label in ["A", "B", "C", "D"]:
            scores = [
                r["llm_scores"][label]
                for r in results_list
                if label in r.get("llm_scores", {})
            ]
            if scores:
                avg_acc = np.mean([s["accuracy"] for s in scores])
                avg_spec = np.mean([s["specificity"] for s in scores])
                avg_hal = np.mean([s["hallucination_free"] for s in scores])
                print(f"  {label}: accuracy={avg_acc:.2f}  specificity={avg_spec:.2f}  hallucination_free={avg_hal:.2f}")

    # ── Verdict ──
    print(f"\n{'=' * 60}")
    print("VERDICT")
    print(f"{'=' * 60}")

    best = max(approaches, key=lambda k: avg_comp[k])
    print(f"\n  Best composite: {best} ({avg_comp[best]:.3f})")

    for k in approaches:
        eff = avg_comp[k] / (avg_tok[k] / full_dump_tokens) if avg_tok[k] > 0 else 0
        print(f"  {k}: composite={avg_comp[k]:.3f}, tokens={avg_tok[k]/full_dump_tokens*100:.1f}%, efficiency={eff:.1f}x")

    # D vs B comparison (hybrid vs simple)
    if avg_comp["D"] > avg_comp["B"] * 1.02:
        print(f"\n  [PASS] D ({avg_comp['D']:.3f}) > B ({avg_comp['B']:.3f}): Hybrid adds value (+{(avg_comp['D']-avg_comp['B'])/avg_comp['B']*100:.1f}%)")
    elif avg_comp["D"] >= avg_comp["B"]:
        print(f"\n  [WARN] D ({avg_comp['D']:.3f}) ~= B ({avg_comp['B']:.3f}): Hybrid marginal")
    else:
        print(f"\n  [FAIL] D ({avg_comp['D']:.3f}) < B ({avg_comp['B']:.3f}): Hybrid hurts")

    # Per-category breakdown
    categories = set(r.get("category", "") for r in results_list)
    if len(categories) > 1:
        print(f"\nPer-category composite (D approach):")
        for cat in sorted(categories):
            cat_results = [r for r in results_list if r.get("category") == cat]
            avg_d = np.mean([r["composite"]["D"] for r in cat_results])
            avg_b = np.mean([r["composite"]["B"] for r in cat_results])
            print(f"  {cat:20s}: D={avg_d:.3f}  B={avg_b:.3f}  ({len(cat_results)} questions)")

    # ── Save results ──
    output = {
        "metadata": {
            "timestamp": datetime.now().isoformat(),
            "embedding_model": EMBEDDING_MODEL,
            "corpus": {"files": n_files, "chunks": len(chunks), "tokens": total_tokens},
            "budget_tokens": CONTEXT_BUDGET_TOKENS,
            "weights": WEIGHTS,
            "embed_time_sec": round(embed_time, 1),
        },
        "summary": {
            "fact_recall": {k: round(avg_fr[k], 3) for k in approaches},
            "source_recall": {k: round(avg_sr[k], 3) for k in approaches},
            "source_precision": {k: round(avg_sp[k], 3) for k in approaches},
            "composite": {k: round(avg_comp[k], 3) for k in approaches},
            "A_fact_recall": round(avg_ret_a, 3),
            "token_pct": {k: round(avg_tok[k] / full_dump_tokens * 100, 1) for k in approaches},
        },
        "questions": results_list,
    }

    output_file = RESULTS_DIR / "experiment_results.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nResults saved to {output_file}")

    return output


# Representative sample: 4 per category (factual, reasoning, task_context)
SAMPLE_QUESTIONS = [
    0, 2, 4, 7,       # factual: Q1(정의), Q3(청킹), Q5(테이블), Q8(배치)
    10, 12, 16, 18,    # reasoning: Q11(MVP-0), Q13(LLM 0회), Q17(Dashboard), Q19(w₂=0)
    20, 23, 27, 29,    # task_context: Q21(파서 참조), Q24(리뷰 항목), Q28(포맷 보존), Q30(에이전트)
]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MDverse Day 1 Hypothesis Validation")
    parser.add_argument("--full", action="store_true", help="Run full experiment with LLM evaluation")
    parser.add_argument("--question", type=int, help="Run single question (0-indexed)")
    parser.add_argument("--sample", action="store_true", help="Run 12 representative questions with --full")
    args = parser.parse_args()

    if args.sample:
        args.full = True

    run_experiment(full_mode=args.full, single_question=args.question,
                   sample_ids=SAMPLE_QUESTIONS if args.sample else None)
