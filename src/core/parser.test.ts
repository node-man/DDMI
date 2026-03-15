import { describe, it, expect } from "vitest";
import { parseMarkdown, guessDocType } from "./parser.js";

const MD_WITH_FRONTMATTER = `---
title: "Test Document"
type: spec
date: "2026-03-15"
tags: [testing, parser]
author: "김개발"
---

# Main Title

## Section One

This is the first section with some **bold** text.

### Subsection

Details here.

## Section Two

- [x] Done item
- [ ] Todo item
- [x] Another done

\`\`\`typescript
const x = 42;
\`\`\`

See also [related doc](./related.md) and [[wikilink-target]].
`;

const MD_NO_FRONTMATTER = `# Simple Document

## Overview

Some content here.

## Details

More content.
`;

describe("parseMarkdown", () => {
  it("extracts frontmatter fields", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    expect(doc.frontmatter.title).toBe("Test Document");
    expect(doc.frontmatter.type).toBe("spec");
    expect(doc.frontmatter.author).toBe("김개발");
  });

  it("extracts title from frontmatter", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    expect(doc.title).toBe("Test Document");
  });

  it("falls back to first heading when no frontmatter title", () => {
    const doc = parseMarkdown(MD_NO_FRONTMATTER, "docs/simple.md");
    expect(doc.title).toBe("Simple Document");
  });

  it("extracts doc type from frontmatter", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    expect(doc.docType).toBe("spec");
  });

  it("guesses doc type from path when no frontmatter", () => {
    const doc = parseMarkdown(MD_NO_FRONTMATTER, "decisions/adr-001.md");
    expect(doc.docType).toBe("decision");
  });

  it("extracts sections", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    expect(doc.sections.length).toBeGreaterThanOrEqual(2);
    const headings = doc.sections.map((s) => s.heading);
    expect(headings).toContain("Section One");
    expect(headings).toContain("Section Two");
  });

  it("extracts markdown links", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    const mdLinks = doc.links.filter((l) => l.type === "markdown");
    expect(mdLinks.length).toBeGreaterThanOrEqual(1);
    expect(mdLinks[0].target).toBe("./related.md");
  });

  it("extracts wikilinks", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    const wikiLinks = doc.links.filter((l) => l.type === "wikilink");
    expect(wikiLinks.length).toBe(1);
    expect(wikiLinks[0].target).toBe("wikilink-target");
  });

  it("computes checklist score", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    // 2 checked out of 3 total
    expect(doc.checklistScore).toBeCloseTo(2 / 3, 1);
  });

  it("returns 0 checklist score when no checklist", () => {
    const doc = parseMarkdown(MD_NO_FRONTMATTER, "docs/simple.md");
    expect(doc.checklistScore).toBe(0);
  });

  it("handles file path for sections", () => {
    const doc = parseMarkdown(MD_WITH_FRONTMATTER, "specs/test.md");
    expect(doc.path).toBe("specs/test.md");
  });
});

describe("guessDocType", () => {
  it("detects decision/adr", () => {
    expect(guessDocType("decisions/adr-001.md")).toBe("decision");
    expect(guessDocType("docs/adr-007-cache.md")).toBe("decision");
  });

  it("detects spec", () => {
    expect(guessDocType("specs/context-curator.md")).toBe("spec");
  });

  it("detects meeting", () => {
    expect(guessDocType("meetings/2026-03-05-kickoff.md")).toBe("meeting");
  });

  it("returns unknown for unrecognized paths", () => {
    expect(guessDocType("README.md")).toBe("unknown");
  });
});
