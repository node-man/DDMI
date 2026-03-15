/**
 * Audit Trail tests — 해시 체인 무결성, 이벤트 기록/조회/검증
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { createAuditTrail } from "./audit.js";
import { initDatabase } from "../storage/sqlite.js";

const TEST_DIR = join(import.meta.dirname, "../../.test-tmp/audit");

function testDbPath(): string {
  return join(TEST_DIR, `test-${randomUUID()}.db`);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe("AuditTrail", () => {
  it("이벤트를 기록하고 조회한다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    const event = trail.log({
      eventType: "file_created",
      actor: "claude",
      targetFile: "specs/api.md",
      details: { action: "create", lines: 50 },
      rationale: "API 스펙 초안 작성",
      basedOn: ["decisions/adr-001.md"],
    });

    expect(event.id).toBeTruthy();
    expect(event.hash).toBeTruthy();
    expect(event.previousHash).toBe("genesis");
    expect(event.eventType).toBe("file_created");

    const events = trail.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(event.id);
  });

  it("해시 체인이 올바르게 연결된다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    const e1 = trail.log({
      eventType: "file_created",
      actor: "claude",
      details: { file: "a.md" },
    });

    const e2 = trail.log({
      eventType: "file_modified",
      actor: "codex",
      details: { file: "a.md", changes: 3 },
    });

    const e3 = trail.log({
      eventType: "conflict_detected",
      actor: "system",
      details: { chunks: ["c1", "c2"] },
    });

    expect(e1.previousHash).toBe("genesis");
    expect(e2.previousHash).toBe(e1.hash);
    expect(e3.previousHash).toBe(e2.hash);
  });

  it("체인 무결성 검증이 통과한다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    trail.log({ eventType: "file_created", actor: "a", details: { x: 1 } });
    trail.log({ eventType: "file_modified", actor: "b", details: { x: 2 } });
    trail.log({ eventType: "decision_made", actor: "c", details: { x: 3 } });

    const result = trail.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBe(3);
  });

  it("탬퍼된 이벤트를 감지한다", () => {
    const dbPath = testDbPath();
    const db = initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    trail.log({ eventType: "file_created", actor: "a", details: { x: 1 } });
    const e2 = trail.log({ eventType: "file_modified", actor: "b", details: { x: 2 } });

    // 직접 SQLite에서 details 조작
    db.prepare("UPDATE audit_log SET details = ? WHERE id = ?")
      .run('{"x": 999}', e2.id);
    db.close();

    const result = trail.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(e2.id);
  });

  it("빈 체인 검증은 valid", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    const result = trail.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBe(0);
  });

  it("파일 이력을 조회한다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    trail.log({ eventType: "file_created", actor: "a", targetFile: "a.md", details: {} });
    trail.log({ eventType: "file_created", actor: "b", targetFile: "b.md", details: {} });
    trail.log({ eventType: "file_modified", actor: "c", targetFile: "a.md", details: {} });

    const history = trail.getFileHistory("a.md");
    expect(history).toHaveLength(2);
    expect(history.every(e => e.targetFile === "a.md")).toBe(true);
  });

  it("이벤트 유형으로 필터한다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    trail.log({ eventType: "file_created", actor: "a", details: {} });
    trail.log({ eventType: "conflict_detected", actor: "b", details: {} });
    trail.log({ eventType: "file_created", actor: "c", details: {} });

    const filtered = trail.getEvents({ eventType: "conflict_detected" });
    expect(filtered).toHaveLength(1);
  });

  it("limit으로 최근 N건만 가져온다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    for (let i = 0; i < 10; i++) {
      trail.log({ eventType: "file_modified", actor: "a", details: { i } });
    }

    const recent = trail.getEvents({ limit: 3 });
    expect(recent).toHaveLength(3);
  });

  it("rationale 조작을 감지한다 (해시에 포함)", () => {
    const dbPath = testDbPath();
    const db = initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    const e = trail.log({
      eventType: "decision_made",
      actor: "human",
      details: { x: 1 },
      rationale: "원래 이유",
    });

    // rationale 조작
    db.prepare("UPDATE audit_log SET rationale = ? WHERE id = ?")
      .run("조작된 이유", e.id);
    db.close();

    const result = trail.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(e.id);
  });

  it("actor 조작을 감지한다 (해시에 포함)", () => {
    const dbPath = testDbPath();
    const db = initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    const e = trail.log({
      eventType: "file_created",
      actor: "claude",
      details: { x: 1 },
    });

    db.prepare("UPDATE audit_log SET actor = ? WHERE id = ?")
      .run("attacker", e.id);
    db.close();

    const result = trail.verifyChain();
    expect(result.valid).toBe(false);
  });

  it("rationale과 basedOn이 저장/조회된다", () => {
    const dbPath = testDbPath();
    initDatabase(dbPath);
    const trail = createAuditTrail(dbPath);

    trail.log({
      eventType: "decision_made",
      actor: "human",
      details: { decision: "캐시 TTL 30분" },
      rationale: "트래픽 패턴 분석 결과",
      basedOn: ["research/traffic.md", "decisions/adr-003.md"],
    });

    const events = trail.getEvents();
    expect(events[0].rationale).toBe("트래픽 패턴 분석 결과");
    expect(events[0].basedOn).toEqual(["research/traffic.md", "decisions/adr-003.md"]);
  });
});
