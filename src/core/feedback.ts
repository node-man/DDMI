/**
 * Feedback — 컨텍스트 품질 피드백 수집
 *
 * MVP-0: 데이터 수집만. 학습은 Phase 2.
 * feedback_log 테이블에 저장하여 프로젝트별 스코어링 자동 학습의 데이터 소스로 사용.
 */

import type Database from "better-sqlite3";
import {
  saveFeedback as dbSaveFeedback,
} from "../storage/sqlite.js";
import type {
  FeedbackInput,
  FeedbackRecord,
  ScoringWeights,
} from "../types.js";
import { DEFAULT_SCORING_WEIGHTS } from "../types.js";

export interface FeedbackContext {
  intent: string;
  taskType: string;
  blocksServed: string[];
  scoringWeights?: ScoringWeights;
}

export function recordFeedback(
  db: Database.Database,
  input: FeedbackInput,
  ctx: FeedbackContext,
): FeedbackRecord {
  return dbSaveFeedback(db, input.feedbackToken, input, {
    intent: ctx.intent,
    taskType: ctx.taskType,
    blocksServed: ctx.blocksServed,
    scoringWeights: ctx.scoringWeights ?? DEFAULT_SCORING_WEIGHTS,
  });
}

export interface FeedbackStats {
  total: number;
  byOutcome: Record<string, number>;
}

export function getFeedbackStats(db: Database.Database): FeedbackStats {
  const total = (
    db.prepare("SELECT COUNT(*) as c FROM feedback_log").get() as { c: number }
  ).c;

  const rows = db
    .prepare(
      "SELECT outcome, COUNT(*) as c FROM feedback_log GROUP BY outcome",
    )
    .all() as Array<{ outcome: string; c: number }>;

  const byOutcome: Record<string, number> = {};
  for (const row of rows) {
    byOutcome[row.outcome] = row.c;
  }

  return { total, byOutcome };
}
