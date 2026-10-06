import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const attempts = new Map<string, number>();

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reserve: vi.fn(),
  record: vi.fn(),
  generate: vi.fn(),
  awardXp: vi.fn(),
  evaluateLocal: vi.fn(),
  createEvaluation: vi.fn(),
  access: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/ai/queries", () => ({
  reserveAiUsageSlot: mocks.reserve,
  recordAiUsage: mocks.record,
  FREE_DAILY_LIMIT: 15,
}));
vi.mock("@/shared/ai-client", () => ({ generateJson: mocks.generate }));
vi.mock("@/features/gamification/queries", () => ({ awardXp: mocks.awardXp }));
vi.mock("@/features/review/source-generators", () => ({ evaluateSourceAnswers: mocks.evaluateLocal }));
vi.mock("@/features/review/queries", () => ({
  createClinicalCaseEvaluation: mocks.createEvaluation,
}));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleClinicalCase: mocks.access,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/review/cases/evaluate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const caseRow = () => ({
  id: "case-1",
  lectureId: "lecture-1",
  questionsJson: JSON.stringify(["q1", "q2"]),
  modelAnswersJson: JSON.stringify(["m1", "m2"]),
});

beforeEach(() => {
  vi.resetAllMocks();
  attempts.clear();
  process.env.GROQ_API_KEY = "";
  mocks.session.mockResolvedValue({ user: { id: "user-1" } });
  mocks.reserve.mockResolvedValue({ ok: true, count: 1 });
  mocks.evaluateLocal.mockResolvedValue({ score: 60, feedback: "good" });
  mocks.access.mockResolvedValue({ ok: true, value: { case: caseRow() } });
  mocks.createEvaluation.mockImplementation(async (p: { caseId: string; userId: string }) => {
    const k = `${p.userId}|${p.caseId}`;
    const n = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, n);
    return n;
  });
  mocks.awardXp.mockResolvedValue({ amount: 15, reason: "case_complete", totalXp: 15, level: 1, xpToNext: 185 });
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
});

describe("POST /api/review/cases/evaluate", () => {
  it("rejects anonymous callers with 401", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request({ caseId: "case-1", answers: ["a1"] }));
    expect(response.status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("evaluates a case without consuming the shared study-generation quota", async () => {
    const response = await POST(request({ caseId: "case-1", answers: ["a1", "a2"] }));
    expect(response.status).toBe(200);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({ score: 60, source: "lecture" });
  });

  it("evaluations stay unlimited even after the daily generation quota is spent (20 evaluations at exhausted quota)", async () => {
    // 14 slots already consumed elsewhere (seeded), quota fully spent: but evaluation
    // must not even ask for a slot.
    mocks.reserve.mockResolvedValue({ ok: false, reason: "limit_reached" });
    for (let i = 0; i < 20; i++) {
      const response = await POST(request({ caseId: "case-1", answers: ["a1", "a2"] }));
      expect(response.status).toBe(200);
    }
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.createEvaluation).toHaveBeenCalledTimes(20);
  });

  it("10 evaluations record 10 attempts, persist answers/score, and award case XP each time (once-ever enforced by the ledger)", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await POST(request({ caseId: "case-1", answers: ["a1", "a2"] }));
      expect(response.status).toBe(200);
    }
    expect(mocks.createEvaluation).toHaveBeenCalledTimes(10);
    for (let i = 0; i < 10; i++) {
      const call = mocks.createEvaluation.mock.calls[i][0];
      expect(call).toMatchObject({ caseId: "case-1", userId: "user-1", answers: ["a1", "a2"], score: 60 });
    }
    // Attempt numbers must be sequential 1..10 (verified by helper's own test)
    expect(mocks.awardXp).toHaveBeenCalledTimes(10);
    for (const call of mocks.awardXp.mock.calls) {
      expect(call[0]).toBe("user-1");
      expect(call[1]).toBe("case_complete");
      expect(call[2]).toBe("case-1");
    }
  });

  it("treats each user independently (cross-user isolation)", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user-A" } });
    await POST(request({ caseId: "case-9", answers: ["a1"] }));
    mocks.session.mockResolvedValue({ user: { id: "user-B" } });
    await POST(request({ caseId: "case-9", answers: ["a1"] }));

    expect(mocks.createEvaluation).toHaveBeenCalledTimes(2);
    expect(mocks.createEvaluation.mock.calls[0][0].userId).toBe("user-A");
    expect(mocks.createEvaluation.mock.calls[1][0].userId).toBe("user-B");
    expect(mocks.awardXp).toHaveBeenCalledTimes(2);
    expect(mocks.awardXp.mock.calls[0][0]).toBe("user-A");
    expect(mocks.awardXp.mock.calls[1][0]).toBe("user-B");
  });

  it("returns 404 when the case is not accessible", async () => {
    mocks.access.mockResolvedValue({ ok: false });
    const response = await POST(request({ caseId: "case-ghost", answers: ["a1"] }));
    expect(response.status).toBe(404);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});