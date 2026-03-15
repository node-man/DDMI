/**
 * MD Parser — remark 기반 마크다운 파서
 *
 * .md 파일을 구조화된 ParsedDocument로 변환한다.
 * - YAML frontmatter 추출
 * - 헤딩 기반 섹션 트리 구성
 * - 코드블록, 체크리스트, 링크 추출
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import type { Root, Content, Heading, ListItem, Link } from "mdast";
import type { ParsedDocument, Section, ExplicitLink } from "../types.js";

// ─── Public API ──────────────────────────────────────────

export function parseMarkdown(
  content: string,
  filePath: string,
): ParsedDocument {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .parse(content);

  const frontmatter = extractFrontmatter(tree, content);
  const title =
    (frontmatter.title as string) ?? extractFirstHeading(tree) ?? null;
  const docType = (frontmatter.type as string) ?? guessDocType(filePath);
  const sections = extractSections(tree, content);
  const links = extractLinks(tree, filePath);
  const checklistScore = computeChecklistScore(tree);

  return {
    path: filePath,
    title,
    docType,
    frontmatter,
    sections,
    links,
    checklistScore,
  };
}

export function guessDocType(filePath: string): string {
  const path = filePath.toLowerCase();
  if (path.includes("decision") || path.includes("adr")) return "decision";
  if (path.includes("spec")) return "spec";
  if (path.includes("meeting")) return "meeting";
  if (path.includes("research")) return "research";
  if (path.includes("sprint")) return "sprint";
  if (path.includes("task")) return "task";
  if (path.includes("agent")) return "agent";
  return "unknown";
}

// ─── Frontmatter ─────────────────────────────────────────

function extractFrontmatter(
  tree: Root,
  rawContent: string,
): Record<string, unknown> {
  const yamlNode = tree.children.find((n) => n.type === "yaml");
  if (!yamlNode || !("value" in yamlNode)) return {};

  const yaml = yamlNode.value as string;
  const result: Record<string, unknown> = {};

  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value: unknown = rawValue.trim();

    // Handle quoted strings
    if (
      (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) ||
      (typeof value === "string" && value.startsWith("'") && value.endsWith("'"))
    ) {
      value = (value as string).slice(1, -1);
    }
    // Handle arrays: [a, b, c]
    else if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }

    result[key] = value;
  }

  return result;
}

// ─── Sections ────────────────────────────────────────────

function extractSections(tree: Root, rawContent: string): Section[] {
  const lines = rawContent.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let contentStart = 0;

  // Skip frontmatter
  if (rawContent.startsWith("---")) {
    const endIdx = rawContent.indexOf("---", 3);
    if (endIdx !== -1) {
      contentStart = rawContent.indexOf("\n", endIdx) + 1;
    }
  }

  const bodyLines = rawContent.slice(contentStart).split("\n");
  let currentHeading = "";
  let currentLevel = 0;
  let currentContent: string[] = [];

  for (const line of bodyLines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentContent.length > 0 || currentHeading) {
        sections.push({
          heading: currentHeading,
          headingLevel: currentLevel,
          content: currentContent.join("\n").trim(),
          children: [],
        });
      }

      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }

  // Last section
  if (currentContent.length > 0 || currentHeading) {
    sections.push({
      heading: currentHeading || "(root)",
      headingLevel: currentLevel || 0,
      content: currentContent.join("\n").trim(),
      children: [],
    });
  }

  return sections;
}

// ─── First Heading ───────────────────────────────────────

function extractFirstHeading(tree: Root): string | null {
  for (const node of tree.children) {
    if (node.type === "heading") {
      return stringifyNode(node);
    }
  }
  return null;
}

// ─── Links ───────────────────────────────────────────────

function extractLinks(tree: Root, filePath: string): ExplicitLink[] {
  const links: ExplicitLink[] = [];
  visitNodes(tree, (node) => {
    // Standard markdown links [text](url)
    if (node.type === "link") {
      const linkNode = node as Link;
      const target = linkNode.url;
      // Only track relative .md links
      if (target && !target.startsWith("http") && (target.endsWith(".md") || target.includes(".md#"))) {
        links.push({
          type: "markdown",
          target,
          text: stringifyNode(linkNode),
          sourceSection: "",
        });
      }
    }
    // Wikilinks [[target]]
    if (node.type === "text" && "value" in node) {
      const text = node.value as string;
      const wikiRe = /\[\[([^\]]+)\]\]/g;
      let match;
      while ((match = wikiRe.exec(text)) !== null) {
        links.push({
          type: "wikilink",
          target: match[1],
          text: match[1],
          sourceSection: "",
        });
      }
    }
  });
  return links;
}

// ─── Checklist Score ─────────────────────────────────────

function computeChecklistScore(tree: Root): number {
  let total = 0;
  let checked = 0;

  visitNodes(tree, (node) => {
    if (node.type === "listItem") {
      const item = node as ListItem;
      if (item.checked !== null && item.checked !== undefined) {
        total++;
        if (item.checked) checked++;
      }
    }
  });

  return total === 0 ? 0 : checked / total;
}

// ─── AST Helpers ─────────────────────────────────────────

function visitNodes(
  node: Root | Content,
  visitor: (node: Content) => void,
): void {
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children as Content[]) {
      visitor(child);
      visitNodes(child, visitor);
    }
  }
}

function stringifyNode(node: Content): string {
  if ("value" in node) return node.value as string;
  if ("children" in node && Array.isArray(node.children)) {
    return (node.children as Content[]).map(stringifyNode).join("");
  }
  return "";
}
