/**
 * Curator unit tests — 스코어링, 예산 패킹, redundancy, coverage 검증
 */

import { describe, it, expect } from "vitest";
import {
  scoreCandidates,
  packBudget,
  computeKeywordBoost,
  computeCoverage,
} from "./curator.js";
import type { ScoredCandidate } from "./curator.js";
import { DEFAULT_SCORING_WEIGHTS } from "../types.js";
import type { SearchResult, ScoringWeights } from "../types.js";

// ─── Test Helpers ────────────────────────────────────────

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-001",
    vector: [],
    fileId: "file-001",
    filePath: "specs/api.md",
    sectionPath: "## API > ### REST",
    content: "REST API 설계 가이드. 엔드포인트는 리소스 기반으로 작성한다.",
    docType: "spec",
    date: "2026-03-01",
    tokenCount: 100,
    distance: 0.3,
    similarity: 0.85,
    ...overrides,
  };
}

function makeResults(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, i) =>
    makeResult({
      id: `chunk-${String(i).padStart(3, "0")}`,
      fileId: `file-${String(i).padStart(3, "0")}`,
      filePath: `docs/doc-${i}.md`,
      sectionPath: `## Section ${i}`,
      content: `Content for chunk ${i}. 서로 다른 내용을 가진 청크.`,
      similarity: 0.9 - i * 0.02,
      distance: 0.1 + i * 0.02,
      tokenCount: 100 + i * 10,
    }),
  );
}

// ─── scoreCandidates ─────────────────────────────────────

describe("scoreCandidates", () => {
  it("모든 후보에 스코어를 할당한다", () => {
    const candidates = makeResults(5);
    const scored = scoreCandidates(
      candidates,
      "REST API 설계",
      "implementation",
      DEFAULT_SCORING_WEIGHTS,
    );

    expect(scored).toHaveLength(5);
    for (const s of scored) {
      expect(s.rawScore).toBeGreaterThan(0);
      expect(s.finalScore).toBe(s.rawScore); // redundancy 미적용 시점
      expect(s.semanticSim).toBeGreaterThanOrEqual(0);
      expect(s.keywordBoost).toBeGreaterThanOrEqual(0);
    }
  });

  it("높은 similarity → 높은 semantic_sim 스코어", () => {
    const candidates = [
      makeResult({ similarity: 0.95 }),
      makeResult({ id: "chunk-002", similarity: 0.50 }),
    ];
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );

    expect(scored[0].semanticSim).toBeGreaterThan(scored[1].semanticSim);
    expect(scored[0].rawScore).toBeGreaterThan(scored[1].rawScore);
  });

  it("recency가 30일 이내면 비활성화 → semantic_sim에 합산", () => {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = [
      makeResult({ date: today }),
      makeResult({ id: "chunk-002", date: today }),
    ];
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );

    // recency 비활성 → wSim = 0.55 + 0.15 = 0.70
    // rawScore should reflect this
    for (const s of scored) {
      expect(s.recency).toBe(0.5); // neutral when inactive
    }
  });

  it("recency가 30일 초과 분산이면 활성화", () => {
    const candidates = [
      makeResult({ date: "2025-01-01" }),
      makeResult({ id: "chunk-002", date: "2026-03-15" }),
    ];
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );

    // 두 날짜 차이 > 30일 → recency 활성
    expect(scored[0].recency).not.toBe(scored[1].recency);
  });

  it("task_aware_authority: spec × implementation → 0.9", () => {
    const candidates = [makeResult({ docType: "spec" })];
    const scored = scoreCandidates(
      candidates,
      "query",
      "implementation",
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(scored[0].taskAwareAuthority).toBe(0.9);
  });

  it("task_aware_authority: meeting × research → 0.5", () => {
    const candidates = [makeResult({ docType: "meeting" })];
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(scored[0].taskAwareAuthority).toBe(0.5);
  });

  it("알 수 없는 docType → 0.5 기본값", () => {
    const candidates = [makeResult({ docType: "unknown-type" })];
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(scored[0].taskAwareAuthority).toBe(0.5);
  });
});

// ─── computeKeywordBoost ─────────────────────────────────

describe("computeKeywordBoost", () => {
  it("모든 키워드 매칭 → 1.0", () => {
    const boost = computeKeywordBoost(
      "REST API",
      "REST API 설계 가이드",
      "## API",
      "specs/api.md",
    );
    expect(boost).toBe(1.0);
  });

  it("키워드 일부 매칭 → 0~1 사이", () => {
    const boost = computeKeywordBoost(
      "REST API 캐시",
      "REST API 설계 가이드",
      "## API",
      "specs/api.md",
    );
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThan(1);
  });

  it("키워드 없음 → 0", () => {
    const boost = computeKeywordBoost(
      "완전히 다른 주제",
      "REST API 설계 가이드",
      "## API",
      "specs/api.md",
    );
    expect(boost).toBe(0);
  });

  it("숫자/식별자 포함 시 추가 부스트", () => {
    // 3개 키워드 중 숫자 포함 vs 미포함, 매칭 1개만 되도록
    const withNum = computeKeywordBoost(
      "설정 8000 없는단어",
      "기본 max_tokens = 8000 설정",
      "## Config",
      "specs/config.md",
    );
    const withoutNum = computeKeywordBoost(
      "설정 기본 없는단어",
      "기본 max_tokens = 8000 설정",
      "## Config",
      "specs/config.md",
    );
    // "8000" 매칭(1 + 0.5) + "설정" 매칭(1) = 2.5/3 = 0.833
    // "기본" 매칭(1) + "설정" 매칭(1) = 2/3 = 0.667
    expect(withNum).toBeGreaterThan(withoutNum);
  });

  it("짧은 키워드(1글자) 무시", () => {
    const boost = computeKeywordBoost(
      "a b c",
      "REST API 설계",
      "## API",
      "specs/api.md",
    );
    expect(boost).toBe(0);
  });

  it("한국어 붙여쓰기 → 띄어쓰기 매칭", () => {
    const boost = computeKeywordBoost(
      "캐시전략",
      "캐시 전략에 대한 설명",
      "## 캐시",
      "specs/cache.md",
    );
    expect(boost).toBeGreaterThan(0);
  });

  it("대소문자 무시", () => {
    const boost = computeKeywordBoost(
      "REST",
      "rest api 설계",
      "## api",
      "specs/api.md",
    );
    expect(boost).toBeGreaterThan(0);
  });
});

// ─── packBudget ──────────────────────────────────────────

describe("packBudget", () => {
  function scoreAll(results: SearchResult[]): ScoredCandidate[] {
    return scoreCandidates(results, "query", "research", DEFAULT_SCORING_WEIGHTS);
  }

  it("예산 내에서 최대한 패킹", () => {
    const scored = scoreAll(makeResults(5));
    const selected = packBudget(scored, 500, DEFAULT_SCORING_WEIGHTS);

    const totalTokens = selected.reduce((s, c) => s + c.result.tokenCount, 0);
    expect(totalTokens).toBeLessThanOrEqual(500);
    expect(selected.length).toBeGreaterThan(0);
  });

  it("예산 0 → 빈 결과", () => {
    const scored = scoreAll(makeResults(3));
    const selected = packBudget(scored, 0, DEFAULT_SCORING_WEIGHTS);
    expect(selected).toHaveLength(0);
  });

  it("MAX_SELECT(10) 제한 적용", () => {
    const scored = scoreAll(makeResults(20));
    const selected = packBudget(scored, 100000, DEFAULT_SCORING_WEIGHTS);
    expect(selected.length).toBeLessThanOrEqual(10);
  });

  it("exclude 필터 적용", () => {
    const scored = scoreAll(makeResults(5));
    const selected = packBudget(scored, 10000, DEFAULT_SCORING_WEIGHTS, [
      "doc-0",
    ]);

    for (const s of selected) {
      expect(s.result.filePath).not.toContain("doc-0");
    }
  });

  it("같은 파일의 유사한 청크는 redundancy로 걸러진다", () => {
    const sameFile = Array.from({ length: 5 }, (_, i) =>
      makeResult({
        id: `chunk-${i}`,
        fileId: "file-same",
        filePath: "docs/same.md",
        sectionPath: `## Section ${i}`,
        content: `거의 동일한 내용 ${i}`,
        similarity: 0.90 - i * 0.001, // 매우 유사한 similarity
        tokenCount: 50,
      }),
    );

    const scored = scoreAll(sameFile);
    const selected = packBudget(scored, 10000, DEFAULT_SCORING_WEIGHTS);

    // 같은 파일 + 비슷한 similarity → redundancy로 일부 제외
    expect(selected.length).toBeLessThan(5);
  });

  it("다른 파일이면 redundancy 임계값 완화", () => {
    const diffFiles = makeResults(3); // 각각 다른 파일
    const scored = scoreAll(diffFiles);
    const selected = packBudget(scored, 10000, DEFAULT_SCORING_WEIGHTS);
    // 다른 파일이면 더 많이 선택됨
    expect(selected.length).toBe(3);
  });
});

// ─── computeCoverage ─────────────────────────────────────

describe("computeCoverage", () => {
  it("모든 후보가 선택되면 coverage 1.0", () => {
    const candidates = makeResults(3);
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );
    const coverage = computeCoverage(candidates, scored);
    expect(coverage).toBe(1.0);
  });

  it("후보가 없으면 coverage 0", () => {
    const coverage = computeCoverage([], []);
    expect(coverage).toBe(0);
  });

  it("일부만 선택되면 0~1 사이", () => {
    const candidates = makeResults(10);
    const scored = scoreCandidates(
      candidates,
      "query",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );
    // 상위 3개만 선택된 것처럼 시뮬레이션
    const partialSelect = scored.slice(0, 3);
    const coverage = computeCoverage(candidates, partialSelect);
    expect(coverage).toBeGreaterThan(0);
    expect(coverage).toBeLessThan(1);
  });
});

// ─── Custom Weights ──────────────────────────────────────

describe("custom weights", () => {
  it("keyword_boost 가중치 변경이 스코어에 반영된다", () => {
    const candidates = [
      makeResult({ content: "REST API 설계 가이드" }),
    ];

    const defaultScored = scoreCandidates(
      candidates,
      "REST API",
      "research",
      DEFAULT_SCORING_WEIGHTS,
    );

    const highKw: ScoringWeights = {
      ...DEFAULT_SCORING_WEIGHTS,
      keywordBoost: 0.50,
      semanticSim: 0.20,
    };
    const highKwScored = scoreCandidates(
      candidates,
      "REST API",
      "research",
      highKw,
    );

    // keyword가 매칭되므로, kw 가중치가 높으면 스코어가 다름
    expect(highKwScored[0].rawScore).not.toBe(defaultScored[0].rawScore);
  });
});
