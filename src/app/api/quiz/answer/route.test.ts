import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  bankAccess: vi.fn(),
  questionAccess: vi.fn(),
  attemptAccess: vi.fn(),
  resolveAttempt: vi.fn(),
  gradeAnswer: vi.fn(),
  awardXp: vi.fn(),
  earnedToday: vi.fn(),
  safeAwardXp: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/practice/queries", () => ({
  gradeAnswer: mocks.gradeAnswer,
  resolveAttempt: mocks.resolveAttempt,
}));
vi.mock("@/features/gamification/queries", () => ({
  awardXp: mocks.awardXp,
  hasEarnedQuizCorrectToday: mocks.earnedToday,
}));
vi.mock("@/features/gamification/error-handling", () => ({
  safeAwardXpGeneral: mocks.safeAwardXp,
}));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleQuestionBankBySlug: mocks.bankAccess,
  getAccessibleQuestion: mocks.questionAccess,
  questionBelongsToBank: (_questionBankId: string, bankId: string) => bankId === "bank-1",
  getAccessibleQuizAttempt: mocks.attemptAccess,
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/quiz/answer", {
    method: "POST",
    body: JSON.stringify(body),
  });

const baseBody = { bankSlug: "renal", questionId: "q1", optionId: "opt-1", timeSpentMs: 2500 };

describe("POST /api/quiz/answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    mocks.bankAccess.mockResolvedValue({ ok: true, value: { id: "bank-1" } });
    mocks.questionAccess.mockResolvedValue({ ok: true, value: { bankId: "bank-1" } });
    mocks.resolveAttempt.mockResolvedValue({ id: "attempt-1" });
    mocks.gradeAnswer.mockResolvedValue({ correct: true, gradeValue: 1 });
    mocks.earnedToday.mockResolvedValue(false);
    mocks.safeAwardXp.mockImplementation(async (fn: () => Promise<void>) => fn());
  });

  it("awards quiz_correct XP on a first correct answer", async () => {
    const res = await POST(req(baseBody));
    expect(res.status).toBe(200);
    expect(mocks.earnedToday).toHaveBeenCalledWith("student-a", "q1");
    expect(mocks.awardXp).toHaveBeenCalledWith("student-a", "quiz_correct", "q1");
  });

  it("never farms XP by re-answering the same question twice in one day", async () => {
    mocks.earnedToday.mockResolvedValue(true);
    const res = await POST(req(baseBody));
    expect(res.status).toBe(200);
    expect(mocks.awardXp).not.toHaveBeenCalled();
  });

  it("does not award XP for an incorrect answer", async () => {
    mocks.gradeAnswer.mockResolvedValue({ correct: false, gradeValue: 0 });
    await POST(req(baseBody));
    expect(mocks.awardXp).not.toHaveBeenCalled();
  });

  it("rejects oversized questionId as malformed input, not a 500", async () => {
    const res = await POST(req({ ...baseBody, questionId: "q".repeat(300) }));
    expect(res.status).toBe(400);
  });

  it("returns 401 for anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await POST(req(baseBody));
    expect(res.status).toBe(401);
  });
});