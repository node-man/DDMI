/**
 * ddmi query — CLI 쿼리
 *
 * 자연어 질의 → Context Curator → 포맷팅 출력
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { createEmbedder } from "../core/embedder.js";
import { createCurator } from "../core/curator.js";
import { loadConfig } from "../core/config.js";
import { initVectorStore } from "../storage/lance.js";
import type { ContextRequest } from "../types.js";

export async function runQuery(
  projectRoot: string,
  question: string,
  options: {
    taskType?: string;
    maxTokens?: string;
    debug?: boolean;
  } = {},
): Promise<void> {
  const ddmiDir = join(projectRoot, ".ddmi");
  const dbPath = join(ddmiDir, "index.db");
  const lancePath = join(ddmiDir, "vectors.lance");

  if (!existsSync(ddmiDir)) {
    console.error("Error: ddmi not initialized. Run 'ddmi init' first.");
    process.exit(1);
  }

  // Initialize
  const embedder = await createEmbedder();
  const lance = await initVectorStore(lancePath);

  const config = loadConfig(projectRoot);
  const curator = await createCurator({
    embedder,
    lance,
    dbPath,
    weights: config.curator.weights,
  });

  const req: ContextRequest = {
    intent: question,
    taskType: (options.taskType as ContextRequest["taskType"]) ?? "research",
    maxTokens: options.maxTokens ? parseInt(options.maxTokens, 10) : 8000,
    debug: options.debug,
  };

  const startTime = Date.now();
  const bundle = await curator.assembleContext(req);
  const elapsed = Date.now() - startTime;

  // Output
  console.log(`\nQuery: "${question}"`);
  console.log(
    `Coverage: ${bundle.coverageScore.toFixed(2)} | Tokens: ${bundle.totalTokens.toLocaleString()}/${req.maxTokens?.toLocaleString()} | ${elapsed}ms`,
  );
  console.log(bundle.metaSummary);

  for (const block of bundle.blocks) {
    console.log(
      `\n${"─".repeat(60)}\nSource: ${block.source} (relevance: ${block.relevance.toFixed(3)}, ${block.tokens} tok)\n${"─".repeat(60)}`,
    );
    // Show first 500 chars of content
    const preview =
      block.content.length > 500
        ? block.content.slice(0, 500) + "\n... [truncated]"
        : block.content;
    console.log(preview);
  }

  if (options.debug && bundle.debugScores) {
    console.log(`\n${"═".repeat(60)}`);
    console.log("DEBUG SCORES (top 15):");
    console.log(`${"═".repeat(60)}`);

    const top = bundle.debugScores
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 15);

    for (const d of top) {
      const mark = d.selected ? ">>>" : "   ";
      console.log(
        `${mark} ${d.finalScore.toFixed(3)} | sim=${d.semanticSim.toFixed(2)} kw=${d.keywordBoost.toFixed(2)} taa=${d.taskAwareAuthority.toFixed(2)} rec=${d.recency.toFixed(2)} pen=${d.redundancyPenalty.toFixed(2)} | ${d.source.slice(0, 50)}`,
      );
    }
  }

  console.log(`\nFeedback token: ${bundle.feedbackToken}`);
}
