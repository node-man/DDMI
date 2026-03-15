/**
 * Chunker — 섹션 기반 청킹
 *
 * ParsedDocument를 ChunkRecord 배열로 변환한다.
 * - 헤딩 단위 분할 (## 이상)
 * - 500토큰 초과 → 문단 재분할
 * - 50토큰 미만 → 인접 섹션과 병합
 */

import { createHash } from "node:crypto";
import type { ParsedDocument, ChunkRecord, Section } from "../types.js";

const MAX_TOKENS = 500;
const MIN_TOKENS = 50;

/** 한국어/영어 혼합 텍스트의 토큰 수 추정 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

/** 파일 ID 생성 (경로 해시) */
export function generateFileId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

/** 청크 ID 생성 (파일ID + 섹션경로 + 인덱스 해시) */
let chunkSeq = 0;
function generateChunkId(fileId: string, sectionPath: string): string {
  chunkSeq++;
  return createHash("sha256")
    .update(`${fileId}:${sectionPath}:${chunkSeq}`)
    .digest("hex")
    .slice(0, 16);
}

/** 파일 checksum 생성 */
export function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function chunkDocument(doc: ParsedDocument): ChunkRecord[] {
  const fileId = generateFileId(doc.path);
  const now = new Date().toISOString();

  // Flatten sections into raw chunks
  const rawChunks: Array<{
    sectionPath: string;
    content: string;
    headingLevel: number;
  }> = [];

  for (const section of doc.sections) {
    const sectionPath = buildSectionPath(section, doc.path);
    const content = section.content;

    if (!content.trim()) continue;

    const tokens = estimateTokens(content);

    if (tokens > MAX_TOKENS) {
      // Split by paragraphs
      const paragraphs = splitByParagraphs(content, sectionPath, section.headingLevel);
      rawChunks.push(...paragraphs);
    } else {
      rawChunks.push({
        sectionPath,
        content,
        headingLevel: section.headingLevel,
      });
    }
  }

  // Merge small chunks
  const merged = mergeSmallChunks(rawChunks);

  // Convert to ChunkRecords
  return merged.map((raw) => {
    const chunkType = detectChunkType(raw.content);
    return {
      id: generateChunkId(fileId, raw.sectionPath),
      fileId,
      sectionPath: raw.sectionPath,
      content: raw.content,
      tokenCount: estimateTokens(raw.content),
      headingLevel: raw.headingLevel,
      chunkType,
      metadata: chunkType === "code" ? extractCodeMeta(raw.content) : {},
      createdAt: now,
    };
  });
}

// ─── Paragraph Splitting ─────────────────────────────────

function splitByParagraphs(
  content: string,
  sectionPath: string,
  headingLevel: number,
): Array<{ sectionPath: string; content: string; headingLevel: number }> {
  const paragraphs = content.split(/\n\n+/);
  const result: typeof paragraphs extends (infer _)[]
    ? Array<{ sectionPath: string; content: string; headingLevel: number }>
    : never = [];

  let currentContent = "";
  let partIndex = 0;

  for (const para of paragraphs) {
    const combined = currentContent
      ? `${currentContent}\n\n${para}`
      : para;

    if (estimateTokens(combined) > MAX_TOKENS && currentContent) {
      partIndex++;
      result.push({
        sectionPath: `${sectionPath} [part ${partIndex}]`,
        content: currentContent.trim(),
        headingLevel,
      });
      currentContent = para;
    } else {
      currentContent = combined;
    }
  }

  if (currentContent.trim()) {
    partIndex++;
    const suffix = partIndex > 1 ? ` [part ${partIndex}]` : "";
    result.push({
      sectionPath: `${sectionPath}${suffix}`,
      content: currentContent.trim(),
      headingLevel,
    });
  }

  return result;
}

// ─── Small Chunk Merging ─────────────────────────────────

function mergeSmallChunks(
  chunks: Array<{
    sectionPath: string;
    content: string;
    headingLevel: number;
  }>,
): typeof chunks {
  if (chunks.length <= 1) return chunks;

  const merged: typeof chunks = [];

  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.content);

    if (
      tokens < MIN_TOKENS &&
      merged.length > 0 &&
      estimateTokens(merged[merged.length - 1].content + "\n\n" + chunk.content) <= MAX_TOKENS
    ) {
      // Merge with previous
      const prev = merged[merged.length - 1];
      prev.content = `${prev.content}\n\n${chunk.content}`;
    } else {
      merged.push({ ...chunk });
    }
  }

  return merged;
}

// ─── Helpers ─────────────────────────────────────────────

function buildSectionPath(section: Section, filePath: string): string {
  if (!section.heading || section.heading === "(root)") {
    return filePath;
  }
  return `${filePath} > ${section.heading}`;
}

function detectChunkType(
  content: string,
): "prose" | "code" | "checklist" | "table" {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const total = lines.length;
  if (total === 0) return "prose";

  // Count lines inside code fences
  let inFence = false;
  let codeLines = 0;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      codeLines++;
    } else if (inFence) {
      codeLines++;
    }
  }

  const checkLines = lines.filter((l) =>
    /^\s*-\s*\[[ x]\]/i.test(l),
  ).length;
  const tableLines = lines.filter(
    (l) => l.includes("|") && l.trim().startsWith("|"),
  ).length;

  if (codeLines / total > 0.4) return "code";
  if (checkLines / total > 0.3) return "checklist";
  if (tableLines / total > 0.3) return "table";
  return "prose";
}

function extractCodeMeta(
  content: string,
): Record<string, unknown> {
  const match = content.match(/```(\w+)/);
  return match ? { language: match[1] } : {};
}
