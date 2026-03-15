/**
 * Audit Trail — 불변 감사 로그 + 해시 체인
 *
 * 모든 변경과 결정의 근거를 추적한다.
 * 해시 체인으로 탬퍼(조작)를 감지한다.
 *
 * 해시 계산: SHA-256(id|eventType|timestamp|details|previousHash)
 * 첫 이벤트의 previousHash = "genesis"
 */

import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent, AuditEventType, AuditFilter } from "../types.js";
import {
  initDatabase,
  insertAuditEvent,
  getAuditEvents,
  getLatestAuditHash,
  getAllAuditEvents,
} from "../storage/sqlite.js";

export interface AuditTrail {
  /** 이벤트 기록. id, timestamp, previousHash, hash는 자동 생성. */
  log(event: {
    eventType: AuditEventType;
    actor: string;
    targetFile?: string;
    targetChunkId?: string;
    details: Record<string, unknown>;
    rationale?: string;
    basedOn?: string[];
  }): AuditEvent;

  /** 필터 기반 이벤트 조회 */
  getEvents(filter?: AuditFilter): AuditEvent[];

  /** 특정 파일의 변경 이력 */
  getFileHistory(filePath: string): AuditEvent[];

  /** 해시 체인 무결성 검증 */
  verifyChain(): { valid: boolean; brokenAt?: string; checkedCount: number };

  /** 최신 해시 */
  getLatestHash(): string;
}

export function createAuditTrail(dbPath: string): AuditTrail {
  const db = initDatabase(dbPath);

  return {
    log(input): AuditEvent {
      const id = randomUUID().slice(0, 16);
      const timestamp = new Date().toISOString();
      const previousHash = getLatestAuditHash(db);

      const eventData = {
        id,
        eventType: input.eventType,
        timestamp,
        actor: input.actor,
        targetFile: input.targetFile,
        targetChunkId: input.targetChunkId,
        details: input.details,
        rationale: input.rationale,
        basedOn: input.basedOn,
        previousHash,
      };

      const hash = computeHash(eventData);

      const event: AuditEvent = {
        ...eventData,
        hash,
      };

      insertAuditEvent(db, event);
      return event;
    },

    getEvents(filter?: AuditFilter): AuditEvent[] {
      return getAuditEvents(db, filter);
    },

    getFileHistory(filePath: string): AuditEvent[] {
      return getAuditEvents(db, { targetFile: filePath });
    },

    verifyChain(): { valid: boolean; brokenAt?: string; checkedCount: number } {
      const events = getAllAuditEvents(db); // rowid ASC
      if (events.length === 0) return { valid: true, checkedCount: 0 };

      let expectedPreviousHash = "genesis";

      for (const event of events) {
        // previousHash 확인
        if (event.previousHash !== expectedPreviousHash) {
          return {
            valid: false,
            brokenAt: event.id,
            checkedCount: events.indexOf(event),
          };
        }

        // hash 재계산 (모든 감사 필드 포함)
        const expectedHash = computeHash(event);

        if (event.hash !== expectedHash) {
          return {
            valid: false,
            brokenAt: event.id,
            checkedCount: events.indexOf(event),
          };
        }

        expectedPreviousHash = event.hash;
      }

      return { valid: true, checkedCount: events.length };
    },

    getLatestHash(): string {
      return getLatestAuditHash(db);
    },
  };
}

function computeHash(event: {
  id: string;
  eventType: string;
  timestamp: string;
  actor: string;
  targetFile?: string;
  targetChunkId?: string;
  details: Record<string, unknown>;
  rationale?: string;
  basedOn?: string[];
  previousHash: string;
}): string {
  const payload = [
    event.id,
    event.eventType,
    event.timestamp,
    event.actor,
    event.targetFile ?? "",
    event.targetChunkId ?? "",
    JSON.stringify(event.details),
    event.rationale ?? "",
    JSON.stringify(event.basedOn ?? []),
    event.previousHash,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
