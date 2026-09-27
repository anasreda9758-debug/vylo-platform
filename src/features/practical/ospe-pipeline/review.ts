import type { PracticalQuestion } from "../model";
import type { ReviewStatus } from "./types";

/**
 * A question is AUTO_VERIFIED_SOURCE when the deterministic parser
 * found the answer directly in the PDF text and the source is
 * traceable. It is NOT yet student-visible — it requires admin
 * APPROVE before PUBLISH (per "none student-visible until approved").
 */
export function isAutoVerifiedSource(q: PracticalQuestion): boolean {
  return q.reviewStatus === "AUTO_VERIFIED_SOURCE";
}

export function canAdminApprove(q: PracticalQuestion): boolean {
  return q.reviewStatus === "AUTO_VERIFIED_SOURCE" || q.reviewStatus === "NEEDS_REVIEW";
}

export function approveQuestion(q: PracticalQuestion): PracticalQuestion {
  if (!canAdminApprove(q)) throw new Error("Question cannot be approved from current review status");
  return { ...q, reviewStatus: "APPROVED", status: "APPROVED" };
}

/** Returns the answer key — admin/review only. Never exposed to students. */
export function adminAnswerKey(q: PracticalQuestion): { answer: string | null; correctOptionId: string } {
  const correct = q.options.find((o) => o.id === q.correctOptionId);
  return { answer: correct?.text ?? null, correctOptionId: q.correctOptionId };
}

export function isAnswerLeak(payload: Record<string, unknown>): boolean {
  const forbidden = ["answer", "correctOptionId", "explanation", "identifyingClue", "commonMistake", "examTip"];
  return forbidden.some((k) => k in payload);
}
