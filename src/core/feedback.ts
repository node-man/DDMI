/**
 * Feedback — 컨텍스트 품질 피드백 수집
 *
 * MVP-0: 데이터 수집만. 학습은 Phase 2.
 * feedback_log 테이블에 저장하여 프로젝트별 스코어링 자동 학습의 데이터 소스로 사용.
 */

import type { FeedbackInput, FeedbackRecord } from "../types.js";

export function saveFeedback(input: FeedbackInput): FeedbackRecord {
  // TODO: implement SQLite storage
  throw new Error("Not implemented");
}
