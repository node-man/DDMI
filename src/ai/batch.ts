/**
 * AI Batch Engine — provider별 배치 크기로 파일을 분할
 *
 * 통합 프롬프트가 소규모 모델(ollama)에서 실패하고,
 * 500파일에서 50파일 캡이 90%를 누락하는 문제를 해결한다.
 * 변경된 파일을 우선 배치에 배치하여 incremental 분석에서 누락 방지.
 */

export interface FileSummary {
  path: string;
  fileId: string;
  docType: string;
  summary: string; // 첫 청크 200자
}

export interface SimilarPair {
  aId: string;
  aContent: string;
  bId: string;
  bContent: string;
}

export interface BatchInput {
  files: FileSummary[];
  pairs: SimilarPair[]; // 이 배치에 속한 파일의 쌍만
}

/** provider별 권장 배치 크기 */
const PROVIDER_BATCH_SIZES: Record<string, number> = {
  ollama: 10,
  claude: 50,
  codex: 50,
  gemini: 50,
};

const DEFAULT_BATCH_SIZE = 50;
const MAX_PAIRS_PER_BATCH = 10;

/**
 * 파일 목록을 provider에 맞는 배치로 분할한다.
 * 변경된 파일이 먼저 배치되어 캡에 걸려도 누락되지 않는다.
 */
export function splitIntoBatches(
  files: FileSummary[],
  pairs: SimilarPair[],
  providerName: string,
  changedPaths: Set<string>,
): BatchInput[] {
  const batchSize = getBatchSize(providerName);

  // 변경 파일 우선 정렬
  const changed = files.filter((f) => changedPaths.has(f.path));
  const unchanged = files.filter((f) => !changedPaths.has(f.path));
  const sorted = [...changed, ...unchanged];

  // 배치 분할
  const batches: BatchInput[] = [];
  for (let i = 0; i < sorted.length; i += batchSize) {
    const batchFiles = sorted.slice(i, i + batchSize);
    const batchFileIds = new Set(batchFiles.map((f) => f.fileId));

    // 이 배치에 속한 파일의 유사 쌍만 포함
    const batchPairs = pairs
      .filter((p) => {
        // 쌍의 양쪽 청크가 이 배치 파일에 속하는지는 chunkId → fileId 매핑이 필요
        // 여기서는 모든 쌍을 마지막 배치에 넣는 대신, 균등 분배
        return true; // 교차 관계는 별도 처리 (index-cmd에서)
      })
      .slice(0, MAX_PAIRS_PER_BATCH);

    batches.push({ files: batchFiles, pairs: [] });
  }

  // 유사 쌍은 마지막 배치에 전부 포함 (배치 간 교차 가능하므로)
  // → 별도 교차 관계 호출로 처리. 여기서는 배치에 포함하지 않음.

  return batches;
}

/**
 * 단일 배치에 대한 AI 프롬프트를 생성한다.
 */
export function buildBatchPrompt(batch: BatchInput, totalFiles: number): string {
  const fileSummaries = batch.files.map(
    (f) => `- ${f.path} [${f.docType}]: ${f.summary}`,
  );

  let pairSection = "";
  if (batch.pairs.length > 0) {
    pairSection = "\n\nSimilar chunk pairs to check for conflicts:\n" +
      batch.pairs.map((p, i) =>
        `Pair ${i}: A(${p.aId}): ${p.aContent.slice(0, 150)} | B(${p.bId}): ${p.bContent.slice(0, 150)}`,
      ).join("\n");
  }

  return `Analyze these ${batch.files.length} markdown files (batch from ${totalFiles} total).

Files:
${fileSummaries.join("\n")}
${pairSection}

Provide a JSON response:

1. "classifications": For files marked [unknown], classify into: spec, decision, meeting, research, sprint, task, agent, guide, config, changelog, readme, plan, retrospective
2. "relations": Meaningful relationships between these files (max ${Math.min(30, batch.files.length * 2)}). Types: references, depends_on, derived_from, supersedes, contradicts
3. "conflicts": From similar pairs above, flag TRUE contradictions only (high precision)

Example response:
{
  "classifications": [{"path": "file.md", "docType": "spec"}],
  "relations": [{"source": "a.md", "target": "b.md", "relationType": "depends_on", "confidence": 0.8}],
  "conflicts": []
}

If a section has no results, use empty array [].`;
}

/**
 * 교차 관계 검증을 위한 프롬프트를 생성한다.
 * 벡터 유사도로 추출된 쌍을 LLM에게 관계/충돌 판단 요청.
 */
export function buildCrossRelationPrompt(
  pairs: SimilarPair[],
  maxPairs: number = 20,
): string {
  const capped = pairs.slice(0, maxPairs);

  return `Analyze these similar document chunk pairs for relationships and conflicts.

${capped.map((p, i) =>
    `Pair ${i}:
  A (${p.aId}): ${p.aContent.slice(0, 200)}
  B (${p.bId}): ${p.bContent.slice(0, 200)}`,
  ).join("\n\n")}

For each pair, determine:
1. Is there a meaningful relationship? (references, depends_on, derived_from, supersedes)
2. Is there a contradiction/conflict?

Respond with JSON:
{
  "relations": [{"pairIndex": 0, "relationType": "references", "confidence": 0.8}],
  "conflicts": [{"pairIndex": 1, "severity": "high", "description": "..."}]
}

Only flag TRUE relationships and conflicts. Prefer high precision.
If nothing found, use empty arrays.`;
}

/** provider 이름에서 배치 크기를 결정 */
export function getBatchSize(providerName: string): number {
  // "cli:claude" → "claude", "ollama:qwen3.5:9b" → "ollama"
  const base = providerName.replace(/^cli:/, "").split(":")[0];
  return PROVIDER_BATCH_SIZES[base] ?? DEFAULT_BATCH_SIZE;
}
