/**
 * index-cmd unit tests — capFileSummaries 프롬프트 캡 로직 검증
 */

import { describe, it, expect } from "vitest";
import { capFileSummaries } from "./index-cmd.js";

describe("capFileSummaries", () => {
  it("변경된 파일을 앞에 배치한다", () => {
    const summaries = ["- a.md: ...", "- b.md: ...", "- c.md: ..."];
    const paths = ["a.md", "b.md", "c.md"];
    const changed = new Set(["c.md"]);

    const result = capFileSummaries(summaries, paths, changed);

    // c.md가 첫 번째
    expect(result[0]).toBe("- c.md: ...");
    expect(result).toHaveLength(3);
  });

  it("50개 초과 시 변경 파일은 보존되고 나머지가 잘린다", () => {
    // 60개 파일, 마지막 5개가 변경됨
    const summaries = Array.from({ length: 60 }, (_, i) => `- file-${i}.md: content`);
    const paths = Array.from({ length: 60 }, (_, i) => `file-${i}.md`);
    const changed = new Set(["file-55.md", "file-56.md", "file-57.md", "file-58.md", "file-59.md"]);

    const result = capFileSummaries(summaries, paths, changed);

    // 50개 + "... and N more" = 51개
    expect(result).toHaveLength(51);
    // 변경된 파일 5개가 모두 앞에 있어야 함
    expect(result[0]).toContain("file-55.md");
    expect(result[1]).toContain("file-56.md");
    expect(result[4]).toContain("file-59.md");
    // 마지막은 생략 메시지
    expect(result[50]).toContain("... and 10 more files");
  });

  it("50개 이하면 캡 없이 전부 반환", () => {
    const summaries = Array.from({ length: 30 }, (_, i) => `- file-${i}.md: content`);
    const paths = Array.from({ length: 30 }, (_, i) => `file-${i}.md`);
    const changed = new Set(["file-0.md"]);

    const result = capFileSummaries(summaries, paths, changed);

    expect(result).toHaveLength(30);
    expect(result[0]).toContain("file-0.md"); // 변경 파일이 첫 번째
  });

  it("변경 파일이 없어도 동작한다", () => {
    const summaries = ["- a.md: ...", "- b.md: ..."];
    const paths = ["a.md", "b.md"];
    const changed = new Set<string>();

    const result = capFileSummaries(summaries, paths, changed);

    expect(result).toHaveLength(2);
  });
});
