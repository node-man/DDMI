#!/usr/bin/env python3
"""
Package A retrieval analysis

Scope:
1. Analyze failure cases Q13 and Q24
2. Sweep top-K chunk limits (3/5/8/10)
3. Compare B vs D vs D-safe

This script is intentionally retrieval-only. It does not call an LLM.
"""

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer


DOCS_DIR = Path(__file__).parent.parent / "docs"
QUESTIONS_FILE = Path(__file__).parent / "questions.json"
EXPERIMENT_RESULTS_FILE = Path(__file__).parent / "results" / "experiment_results.json"
OUTPUT_FILE = Path(__file__).parent / "results" / "package_a_results.json"
EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
TOP_K_INITIAL = 50
TOP_K_SWEEP = [3, 5, 8, 10]
CONTEXT_BUDGET_TOKENS = 8000
HYBRID_KEYWORD_WEIGHT = 0.75
FAILURE_CASES = [13, 24]


@dataclass
class MDChunk:
    file_path: str
    section_path: str
    content: str
    doc_type: str
    date: str
    token_count: int


def parse_frontmatter(content: str) -> tuple[dict, str]:
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    try:
        import yaml
        fm = yaml.safe_load(parts[1]) or {}
    except Exception:
        fm = {}
        for line in parts[1].strip().split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm, parts[2]


def guess_doc_type(path: str) -> str:
    for t in ["decision", "spec", "meeting", "research", "sprint", "task", "agent"]:
        if t in path:
            return t
    return "unknown"


def split_by_headings(body: str, file_path: str) -> list[tuple[str, str]]:
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
    chunks = []
    for md_file in sorted(docs_dir.rglob("*.md")):
        rel_path = str(md_file.relative_to(docs_dir))
        content = md_file.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(content)
        doc_type = frontmatter.get("type", guess_doc_type(rel_path))
        date = str(frontmatter.get("date", "2026-03-01"))

        for section_path, section_content in split_by_headings(body, rel_path):
            stripped = section_content.strip()
            if len(stripped) < 20:
                continue
            chunks.append(
                MDChunk(
                    file_path=rel_path,
                    section_path=section_path,
                    content=stripped,
                    doc_type=doc_type,
                    date=date,
                    token_count=max(1, len(stripped) // 3),
                )
            )
    return chunks


def keyword_boost(query: str, content: str, path: str) -> float:
    terms = [t.lower() for t in re.split(r"\s+", query) if len(t) >= 2]
    if not terms:
        return 0.0
    target = (content + " " + path).lower()
    matches = 0.0
    for term in terms:
        if term in target:
            matches += 1.0
            if any(ch.isdigit() for ch in term) or "_" in term or "." in term or "-" in term:
                matches += 0.5
    return matches / len(terms)


def normalize_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9
    return matrix / norms


def search_dense(query_vec: np.ndarray, chunks: list[MDChunk], chunk_matrix: np.ndarray) -> list[dict]:
    q = query_vec / (np.linalg.norm(query_vec) + 1e-9)
    sims = chunk_matrix @ q
    indices = np.argsort(-sims)[:TOP_K_INITIAL]
    results = []
    for rank, idx in enumerate(indices, start=1):
        chunk = chunks[int(idx)]
        results.append(
            {
                "file_path": chunk.file_path,
                "section_path": chunk.section_path,
                "content": chunk.content,
                "doc_type": chunk.doc_type,
                "date": chunk.date,
                "token_count": chunk.token_count,
                "_sim": float(sims[int(idx)]),
                "_dense_rank": rank,
            }
        )
    return results


def pack_results(results: list[dict], top_k_select: int, budget: int = CONTEXT_BUDGET_TOKENS) -> list[dict]:
    selected = []
    total_tokens = 0
    for r in results:
        if total_tokens + r["token_count"] > budget:
            continue
        selected.append(r)
        total_tokens += r["token_count"]
        if len(selected) >= top_k_select:
            break
    return selected


def approach_b(base_results: list[dict], top_k_select: int) -> list[dict]:
    ordered = sorted(base_results, key=lambda x: x["_sim"], reverse=True)
    return pack_results(ordered, top_k_select)


def approach_d(base_results: list[dict], query_text: str, top_k_select: int) -> list[dict]:
    results = [dict(r) for r in base_results]
    for r in results:
        r["_kw"] = keyword_boost(query_text, r["content"], f"{r['section_path']} {r['file_path']}")
    kw_sorted = sorted(results, key=lambda x: x["_kw"], reverse=True)
    for i, r in enumerate(kw_sorted, start=1):
        r["_kw_rank"] = i
    k = 60
    for r in results:
        r["_rrf"] = 1.0 / (k + r["_dense_rank"]) + HYBRID_KEYWORD_WEIGHT * (1.0 / (k + r["_kw_rank"]))
    ordered = sorted(results, key=lambda x: x["_rrf"], reverse=True)
    return pack_results(ordered, top_k_select)


def approach_d_safe(base_results: list[dict], query_text: str, top_k_select: int) -> list[dict]:
    results = [dict(r) for r in base_results]
    for r in results:
        r["_kw"] = keyword_boost(query_text, r["content"], f"{r['section_path']} {r['file_path']}")
    kw_sorted = sorted(results, key=lambda x: x["_kw"], reverse=True)
    for i, r in enumerate(kw_sorted, start=1):
        r["_kw_rank"] = i
    k = 60
    for r in results:
        r["_rrf"] = 1.0 / (k + r["_dense_rank"]) + HYBRID_KEYWORD_WEIGHT * (1.0 / (k + r["_kw_rank"]))

    dense_anchor = sorted(results, key=lambda x: x["_sim"], reverse=True)[:10]
    hybrid_expand = sorted(results, key=lambda x: x["_rrf"], reverse=True)[:20]
    candidate_keys = {
        (r["file_path"], r["section_path"], r["content"])
        for r in dense_anchor + hybrid_expand
    }
    candidates = [
        r for r in results
        if (r["file_path"], r["section_path"], r["content"]) in candidate_keys
    ]
    ordered = sorted(candidates, key=lambda x: (x["_sim"], x["_kw"]), reverse=True)
    return pack_results(ordered, top_k_select)


def evaluate_fact_recall(selected: list[dict], key_facts: list[str]) -> float:
    if not key_facts:
        return 0.0
    all_content = " ".join(r["content"] for r in selected).lower()
    found = sum(1 for fact in key_facts if fact.lower() in all_content)
    return found / len(key_facts)


def evaluate_source_recall(selected: list[dict], expected_sources: list[str]) -> float:
    if not expected_sources:
        return 0.0
    selected_files = set(r["file_path"] for r in selected)
    found = sum(1 for src in expected_sources if src in selected_files)
    return found / len(expected_sources)


def evaluate_source_precision(selected: list[dict], expected_sources: list[str]) -> float:
    if not selected or not expected_sources:
        return 0.0
    selected_files = set(r["file_path"] for r in selected)
    if not selected_files:
        return 0.0
    relevant = sum(1 for f in selected_files if f in expected_sources)
    return relevant / len(selected_files)


def evaluate(selected: list[dict], key_facts: list[str], expected_sources: list[str]) -> dict:
    fr = evaluate_fact_recall(selected, key_facts)
    sr = evaluate_source_recall(selected, expected_sources)
    sp = evaluate_source_precision(selected, expected_sources)
    composite = 0.4 * fr + 0.4 * sr + 0.2 * sp
    return {
        "fact_recall": round(fr, 3),
        "source_recall": round(sr, 3),
        "source_precision": round(sp, 3),
        "composite": round(composite, 3),
        "avg_tokens": sum(r["token_count"] for r in selected),
    }


def summarize_question(selected: list[dict], expected_sources: list[str]) -> list[dict]:
    expected = set(expected_sources)
    out = []
    for idx, r in enumerate(selected, start=1):
        out.append(
            {
                "rank": idx,
                "file_path": r["file_path"],
                "section_path": r["section_path"],
                "sim": round(r.get("_sim", 0.0), 3),
                "kw": round(r.get("_kw", 0.0), 3),
                "rrf": round(r.get("_rrf", 0.0), 4),
                "expected_source": r["file_path"] in expected,
            }
        )
    return out


def load_latest_llm_scores() -> dict[int, dict]:
    if not EXPERIMENT_RESULTS_FILE.exists():
        return {}
    obj = json.loads(EXPERIMENT_RESULTS_FILE.read_text(encoding="utf-8"))
    scores = {}
    for q in obj.get("questions", []):
        scores[q["id"]] = q.get("llm_scores", {})
    return scores


def mean_metric(rows: list[dict], metric: str) -> float:
    return round(float(np.mean([r[metric] for r in rows])), 3)


def main() -> None:
    questions = json.loads(QUESTIONS_FILE.read_text(encoding="utf-8"))
    chunks = parse_md_files(DOCS_DIR)

    model = SentenceTransformer(EMBEDDING_MODEL)
    texts = [f"{c.section_path}\n{c.content}" for c in chunks]
    chunk_embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)
    chunk_matrix = normalize_rows(np.asarray(chunk_embeddings))
    query_embeddings = model.encode([q["question"] for q in questions], show_progress_bar=True, batch_size=32)

    llm_scores = load_latest_llm_scores()
    sweep = {}
    failure_analysis = {}

    for top_k in TOP_K_SWEEP:
        rows = {"B": [], "D": [], "D_safe": []}

        for q, q_emb in zip(questions, query_embeddings):
            base_results = search_dense(np.asarray(q_emb), chunks, chunk_matrix)
            selected_b = approach_b(base_results, top_k)
            selected_d = approach_d(base_results, q["question"], top_k)
            selected_safe = approach_d_safe(base_results, q["question"], top_k)

            rows["B"].append(evaluate(selected_b, q["key_facts"], q.get("expected_sources", [])))
            rows["D"].append(evaluate(selected_d, q["key_facts"], q.get("expected_sources", [])))
            rows["D_safe"].append(evaluate(selected_safe, q["key_facts"], q.get("expected_sources", [])))

            if top_k == 10 and q["id"] in FAILURE_CASES:
                failure_analysis[q["id"]] = {
                    "question": q["question"],
                    "expected_sources": q.get("expected_sources", []),
                    "llm_scores_from_latest_codex_run": llm_scores.get(q["id"], {}),
                    "B": {
                        "metrics": rows["B"][-1],
                        "selected": summarize_question(selected_b, q.get("expected_sources", [])),
                    },
                    "D": {
                        "metrics": rows["D"][-1],
                        "selected": summarize_question(selected_d, q.get("expected_sources", [])),
                    },
                    "D_safe": {
                        "metrics": rows["D_safe"][-1],
                        "selected": summarize_question(selected_safe, q.get("expected_sources", [])),
                    },
                }

        sweep[str(top_k)] = {
            label: {
                "fact_recall": mean_metric(values, "fact_recall"),
                "source_recall": mean_metric(values, "source_recall"),
                "source_precision": mean_metric(values, "source_precision"),
                "composite": mean_metric(values, "composite"),
                "avg_tokens": round(float(np.mean([v["avg_tokens"] for v in values])), 1),
            }
            for label, values in rows.items()
        }

    recommendation = {
        "best_top_k_for_B": max(TOP_K_SWEEP, key=lambda k: sweep[str(k)]["B"]["composite"]),
        "best_top_k_for_D": max(TOP_K_SWEEP, key=lambda k: sweep[str(k)]["D"]["composite"]),
        "best_top_k_for_D_safe": max(TOP_K_SWEEP, key=lambda k: sweep[str(k)]["D_safe"]["composite"]),
        "best_overall": max(
            [(int(k), label, vals["composite"]) for k, group in sweep.items() for label, vals in group.items()],
            key=lambda x: x[2],
        ),
    }

    output = {
        "metadata": {
            "timestamp": datetime.now().isoformat(),
            "embedding_model": EMBEDDING_MODEL,
            "corpus": {
                "files": len(set(c.file_path for c in chunks)),
                "chunks": len(chunks),
                "tokens": sum(c.token_count for c in chunks),
            },
            "scope": "Package A",
            "top_k_sweep": TOP_K_SWEEP,
            "failure_cases": FAILURE_CASES,
        },
        "sweep": sweep,
        "failure_analysis": failure_analysis,
        "recommendation": {
            "best_top_k_for_B": recommendation["best_top_k_for_B"],
            "best_top_k_for_D": recommendation["best_top_k_for_D"],
            "best_top_k_for_D_safe": recommendation["best_top_k_for_D_safe"],
            "best_overall": {
                "top_k": recommendation["best_overall"][0],
                "approach": recommendation["best_overall"][1],
                "composite": recommendation["best_overall"][2],
            },
        },
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(output["recommendation"], ensure_ascii=False, indent=2))
    print(f"Saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
