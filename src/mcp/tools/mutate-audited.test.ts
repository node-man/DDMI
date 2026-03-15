/**
 * mutate_audited MCP tool tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { handleMutateAudited } from "./mutate-audited.js";
import { initDatabase } from "../../storage/sqlite.js";

const TEST_DIR = join(import.meta.dirname, "../../../.test-tmp/mutate");

function setup() {
  const id = randomUUID().slice(0, 8);
  const projectRoot = join(TEST_DIR, id);
  mkdirSync(projectRoot, { recursive: true });
  const ddmiDir = join(projectRoot, ".ddmi");
  mkdirSync(ddmiDir);
  const dbPath = join(ddmiDir, "index.db");
  initDatabase(dbPath);
  return { projectRoot, dbPath };
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("mutate_audited", () => {
  it("create: 파일을 생성하고 audit 기록한다", async () => {
    const { projectRoot, dbPath } = setup();
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "docs/test.md",
      content: "# Test", rationale: "테스트", based_on: ["x.md"],
    });
    expect(r.content[0].text).toContain("Created");
    expect(existsSync(join(projectRoot, "docs/test.md"))).toBe(true);
  });

  it("create: 이미 존재하면 에러", async () => {
    const { projectRoot, dbPath } = setup();
    await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "a.md",
      content: "x", rationale: "t", based_on: ["x"],
    });
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "a.md",
      content: "x", rationale: "t", based_on: ["x"],
    });
    expect(r.content[0].text).toContain("already exists");
  });

  it("patch: 내용을 추가한다", async () => {
    const { projectRoot, dbPath } = setup();
    await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "a.md",
      content: "line1", rationale: "t", based_on: ["x"],
    });
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "patch", target: "a.md",
      content: "line2", rationale: "추가", based_on: ["x"],
    });
    expect(r.content[0].text).toContain("Patched");
    const content = readFileSync(join(projectRoot, "a.md"), "utf-8");
    expect(content).toContain("line1");
    expect(content).toContain("line2");
  });

  it("replace_section: 섹션 내용을 교체한다", async () => {
    const { projectRoot, dbPath } = setup();
    await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "a.md",
      content: "# Title\n\n## Sec1\n\nOld.\n\n## Sec2\n\nKeep.", rationale: "t", based_on: ["x"],
    });
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "replace_section", target: "a.md", section: "## Sec1",
      content: "New content.", rationale: "수정", based_on: ["x"],
    });
    expect(r.content[0].text).toContain("Replaced");
    const content = readFileSync(join(projectRoot, "a.md"), "utf-8");
    expect(content).toContain("New content.");
    expect(content).toContain("Keep.");
    expect(content).not.toContain("Old.");
  });

  it("rationale 누락 시 에러", async () => {
    const { projectRoot, dbPath } = setup();
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "a.md",
      content: "x", rationale: "", based_on: [],
    });
    expect(r.content[0].text).toContain("rationale is required");
  });

  it("basedOn 누락 시 에러", async () => {
    const { projectRoot, dbPath } = setup();
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "a.md",
      content: "x", rationale: "r", based_on: [],
    });
    expect(r.content[0].text).toContain("based_on is required");
  });

  it("path traversal 차단", async () => {
    const { projectRoot, dbPath } = setup();
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "create", target: "../../evil.md",
      content: "x", rationale: "r", based_on: ["x"],
    });
    expect(r.content[0].text).toContain("traversal blocked");
  });

  it("존재하지 않는 파일에 patch 시 에러", async () => {
    const { projectRoot, dbPath } = setup();
    const r = await handleMutateAudited(projectRoot, dbPath, {
      action: "patch", target: "nonexistent.md",
      content: "x", rationale: "r", based_on: ["x"],
    });
    expect(r.content[0].text).toContain("not found");
  });
});
