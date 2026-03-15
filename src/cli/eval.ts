/**
 * ddmi eval — 평가 프레임워크
 *
 * questions.json을 로드하여 context_assemble 품질을 자동 측정한다.
 * - fact_recall: key_facts가 선택된 청크에 포함되는 비율
 * - source_recall: expected_sources가 선택된 파일에 포함되는 비율
 * - source_precision: 선택된 파일 중 expected_sources 비율
 * - composite: 0.4 * fact_recall + 0.4 * source_recall + 0.2 * source_precision
 *
 * 가중치 변경 후 `ddmi eval` 한 줄로 재평가 가능.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEmbedder } from "../core/embedder.js";
import { createCurator, type CuratorDeps } from "../core/curator.js";
import { loadConfig } from "../core/config.js";
import { initVectorStore } from "../storage/lance.js";
import type { ScoringWeights } from "../types.js";

interface EvalQuestion {
  id: number;
  question: string;
  category: string;
  task_type: string;
  key_facts: string[];
  expected_sources: string[];
}

interface QuestionResult {
  id: number;
  question: string;
  category: string;
  factRecall: number;
  sourceRecall: number;
  sourcePrecision: number;
  composite: number;
  tokens: number;
  sources: string[];
}

// ─── Evaluation Functions ────────────────────────────────

function factRecall(content: string, keyFacts: string[]): number {
  if (keyFacts.length === 0) return 0;
  const lower = content.toLowerCase();
  const found = keyFacts.filter((f) => lower.includes(f.toLowerCase())).length;
  return found / keyFacts.length;
}

function sourceRecall(
  selectedFiles: Set<string>,
  expectedSources: string[],
): number {
  if (expectedSources.length === 0) return 0;
  const found = expectedSources.filter((s) =>
    [...selectedFiles].some((f) => f.includes(s)),
  ).length;
  return found / expectedSources.length;
}

function sourcePrecision(
  selectedFiles: Set<string>,
  expectedSources: string[],
): number {
  if (selectedFiles.size === 0 || expectedSources.length === 0) return 0;
  const relevant = [...selectedFiles].filter((f) =>
    expectedSources.some((s) => f.includes(s)),
  ).length;
  return relevant / selectedFiles.size;
}

// ─── Main ────────────────────────────────────────────────

export async function runEval(
  projectRoot: string,
  options: {
    questionsPath?: string;
    question?: number;
    weightsOverride?: Partial<ScoringWeights>;
  } = {},
): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");
  const lancePath = join(ddmiDir, "vectors.lance");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init && ddmi index' first.");
    process.exit(1);
  }

  // Load questions
  const qPath =
    options.questionsPath ?? join(projectRoot, "eval", "questions.json");
  if (!existsSync(qPath)) {
    console.error(`Error: questions file not found: ${qPath}`);
    process.exit(1);
  }

  let questions: EvalQuestion[] = JSON.parse(
    readFileSync(qPath, "utf-8"),
  );

  if (options.question !== undefined && options.question !== null) {
    const qIdx = options.question;
    questions = questions.filter((q) => q.id === qIdx + 1);
    if (questions.length === 0) {
      console.error(`Error: question ${options.question} not found`);
      process.exit(1);
    }
  }

  // Initialize
  const embedder = await createEmbedder();
  const lance = await initVectorStore(lancePath);

  const config = loadConfig(projectRoot);
  const weights: ScoringWeights = {
    ...config.curator.weights,
    ...options.weightsOverride,
  };

  const deps: CuratorDeps = { embedder, lance, dbPath, weights };
  const curator = await createCurator(deps);

  console.log("=" .repeat(60));
  console.log("ddmi eval — Context Quality Evaluation");
  console.log("=".repeat(60));
  console.log(`Questions: ${questions.length}`);
  console.log(`Weights: sim=${weights.semanticSim} kw=${weights.keywordBoost} taa=${weights.taskAwareAuthority} rec=${weights.recency}`);
  console.log();

  const results: QuestionResult[] = [];

  for (const q of questions) {
    const bundle = await curator.assembleContext({
      intent: q.question,
      taskType: q.task_type as "implementation" | "review" | "research" | "planning",
      maxTokens: 8000,
    });

    const allContent = bundle.blocks.map((b) => b.content).join(" ");
    const selectedFiles = new Set(
      bundle.blocks.map((b) => b.source.split("#")[0]),
    );

    const fr = factRecall(allContent, q.key_facts);
    const sr = sourceRecall(selectedFiles, q.expected_sources);
    const sp = sourcePrecision(selectedFiles, q.expected_sources);
    const comp = 0.4 * fr + 0.4 * sr + 0.2 * sp;

    results.push({
      id: q.id,
      question: q.question,
      category: q.category,
      factRecall: fr,
      sourceRecall: sr,
      sourcePrecision: sp,
      composite: comp,
      tokens: bundle.totalTokens,
      sources: [...selectedFiles],
    });

    const mark = comp >= 0.6 ? "OK" : comp >= 0.3 ? ".." : "XX";
    console.log(
      `  [${mark}] Q${q.id}: fr=${fr.toFixed(2)} sr=${sr.toFixed(2)} sp=${sp.toFixed(2)} comp=${comp.toFixed(3)} | ${q.question.slice(0, 45)}`,
    );
  }

  // Summary
  const n = results.length;
  const avgFr = results.reduce((s, r) => s + r.factRecall, 0) / n;
  const avgSr = results.reduce((s, r) => s + r.sourceRecall, 0) / n;
  const avgSp = results.reduce((s, r) => s + r.sourcePrecision, 0) / n;
  const avgComp = results.reduce((s, r) => s + r.composite, 0) / n;
  const avgTok = results.reduce((s, r) => s + r.tokens, 0) / n;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`SUMMARY (${n} questions)`);
  console.log(`${"─".repeat(60)}`);
  console.log(`  fact_recall:      ${avgFr.toFixed(3)}`);
  console.log(`  source_recall:    ${avgSr.toFixed(3)}`);
  console.log(`  source_precision: ${avgSp.toFixed(3)}`);
  console.log(`  COMPOSITE:        ${avgComp.toFixed(3)}`);
  console.log(`  avg tokens:       ${avgTok.toFixed(0)}`);

  // Per-category
  const categories = [...new Set(results.map((r) => r.category))];
  if (categories.length > 1) {
    console.log(`\nPer-category composite:`);
    for (const cat of categories.sort()) {
      const catResults = results.filter((r) => r.category === cat);
      const catComp =
        catResults.reduce((s, r) => s + r.composite, 0) / catResults.length;
      console.log(`  ${cat.padEnd(20)} ${catComp.toFixed(3)} (${catResults.length} questions)`);
    }
  }

  // Pass/fail
  const passCount = results.filter((r) => r.composite >= 0.3).length;
  console.log(
    `\n  ${passCount}/${n} questions above 0.3 composite threshold`,
  );
}
