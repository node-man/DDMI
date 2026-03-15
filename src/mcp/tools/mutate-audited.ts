/**
 * mutate_audited MCP Tool
 *
 * Agent가 MD 파일을 변경할 때 반드시 이 도구를 통해야 한다.
 * rationale + basedOn 필수 — 변경 이유와 근거 없이는 파일 수정 불가.
 * 변경 후 audit_log에 기록.
 * 리인덱싱은 serve --watch의 chokidar가 감지하여 자동 실행.
 * watch 없이 실행 시에는 ddmi index --incremental을 수동 실행.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createAuditTrail } from "../../core/audit.js";

export const TOOL_NAME = "mutate_audited";

export const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Create or modify a markdown file with mandatory audit trail. " +
    "Requires rationale (why) and basedOn (source documents). " +
    "All changes are logged with hash chain for tamper detection.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "patch", "replace_section"],
        description: "create: new file, patch: append/prepend, replace_section: replace heading section",
      },
      target: {
        type: "string",
        description: "Relative file path (e.g., specs/cache.md)",
      },
      content: {
        type: "string",
        description: "Content to write/append/replace",
      },
      section: {
        type: "string",
        description: "Section heading to replace (for replace_section only, e.g., '## Cache Strategy')",
      },
      rationale: {
        type: "string",
        description: "Why this change is being made (REQUIRED)",
      },
      based_on: {
        type: "array",
        items: { type: "string" },
        description: "Source documents this change is based on (REQUIRED, e.g., ['decisions/adr-007.md'])",
      },
    },
    required: ["action", "target", "content", "rationale", "based_on"],
  },
};

export async function handleMutateAudited(
  projectRoot: string,
  dbPath: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const action = args.action as string;
  const target = args.target as string;
  const content = args.content as string;
  const section = args.section as string | undefined;
  const rationale = args.rationale as string;
  const basedOn = args.based_on as string[];

  // Validation: rationale + basedOn 필수
  if (!rationale || rationale.trim().length === 0) {
    return error("rationale is required. Explain why this change is needed.");
  }
  if (!basedOn || basedOn.length === 0) {
    return error("based_on is required. List the source documents this change references.");
  }
  if (!target || target.trim().length === 0) {
    return error("target file path is required.");
  }

  // Path traversal 방지: projectRoot 밖으로 나가는 경로 차단
  const filePath = join(projectRoot, target);
  const resolvedPath = resolve(filePath);
  const rootResolved = resolve(projectRoot);
  if (!resolvedPath.startsWith(rootResolved + "/") && resolvedPath !== rootResolved) {
    return error(`Path traversal blocked: "${target}" escapes project root.`);
  }
  const trail = createAuditTrail(dbPath);

  try {
    switch (action) {
      case "create": {
        if (existsSync(filePath)) {
          return error(`File already exists: ${target}. Use 'patch' or 'replace_section' to modify.`);
        }
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, "utf-8");

        const event = trail.log({
          eventType: "file_created",
          actor: "agent",
          targetFile: target,
          details: { action: "create", contentLength: content.length },
          rationale,
          basedOn,
        });

        return success(`Created ${target} (${content.length} chars)`, event.id);
      }

      case "patch": {
        if (!existsSync(filePath)) {
          return error(`File not found: ${target}. Use 'create' for new files.`);
        }
        const existing = readFileSync(filePath, "utf-8");
        const patched = existing + "\n" + content;
        writeFileSync(filePath, patched, "utf-8");

        const event = trail.log({
          eventType: "file_modified",
          actor: "agent",
          targetFile: target,
          details: { action: "patch", appendedLength: content.length },
          rationale,
          basedOn,
        });

        return success(`Patched ${target} (+${content.length} chars)`, event.id);
      }

      case "replace_section": {
        if (!existsSync(filePath)) {
          return error(`File not found: ${target}.`);
        }
        if (!section) {
          return error("section is required for replace_section action.");
        }

        const original = readFileSync(filePath, "utf-8");
        const replaced = replaceSectionContent(original, section, content);

        if (replaced === null) {
          return error(`Section not found: "${section}" in ${target}.`);
        }

        writeFileSync(filePath, replaced, "utf-8");

        const event = trail.log({
          eventType: "file_modified",
          actor: "agent",
          targetFile: target,
          details: { action: "replace_section", section, newLength: content.length },
          rationale,
          basedOn,
        });

        return success(`Replaced section "${section}" in ${target}`, event.id);
      }

      default:
        return error(`Unknown action: ${action}. Use create, patch, or replace_section.`);
    }
  } catch (err) {
    return error(`Failed: ${(err as Error).message}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────

function replaceSectionContent(
  original: string,
  sectionHeading: string,
  newContent: string,
): string | null {
  const lines = original.split("\n");
  const headingLevel = sectionHeading.match(/^#+/)?.[0]?.length ?? 2;
  const headingText = sectionHeading.replace(/^#+\s*/, "");

  // 섹션 시작 찾기
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#+)\s+(.*)/);
    if (match && match[1].length === headingLevel && match[2].trim() === headingText.trim()) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return null;

  // 섹션 끝 찾기 (같은 레벨 이상의 다음 헤딩 또는 파일 끝)
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#+)\s/);
    if (match && match[1].length <= headingLevel) {
      endIdx = i;
      break;
    }
  }

  // 원본 포맷 보존: 헤딩 라인 유지, 내용만 교체
  const headingLine = lines[startIdx];
  const result = [
    ...lines.slice(0, startIdx),
    headingLine,
    "",
    newContent,
    "",
    ...lines.slice(endIdx),
  ];

  return result.join("\n");
}

function success(message: string, auditId: string) {
  return {
    content: [{
      type: "text" as const,
      text: `${message}\nAudit ID: ${auditId}\nNote: Run 'ddmi index --incremental' to update the search index, or use 'ddmi serve --watch' for automatic reindexing.`,
    }],
  };
}

function error(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}
