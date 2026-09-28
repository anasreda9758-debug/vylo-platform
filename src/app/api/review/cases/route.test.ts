import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  lectureAccess: vi.fn(),
  clinicalCaseAccess: vi.fn(),
  beginGeneration: vi.fn(),
  finalizeGeneration: vi.fn(),
  reserveSlot: vi.fn(),
  recordUsage: vi.fn(),
  generateJson: vi.fn(),
  createCase: vi.fn(),
  listCases: vi.fn(),
  createSourceCase: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/ai/queries", () => ({
  reserveAiUsageSlot: mocks.reserveSlot,
  recordAiUsage: mocks.recordUsage,
  FREE_DAILY_LIMIT: 15,
}));
vi.mock("@/features/gamification/idempotency", () => ({
  beginGeneration: mocks.beginGeneration,
  finalizeGeneration: mocks.finalizeGeneration,
}));
vi.mock("@/shared/ai-client", () => ({ generateJson: mocks.generateJson }));
vi.mock("@/features/review/queries", () => ({
  createClinicalCase: mocks.createCase,
  listMyCases: mocks.listCases,
}));
vi.mock("@/features/review/source-generators", () => ({
  createSourceClinicalCase: mocks.createSourceCase,
}));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleLecture: mocks.lectureAccess,
  getAccessibleClinicalCase: mocks.clinicalCaseAccess,
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/review/cases", {
    method: "POST",
    body: JSON.stringify(body),
  });

const LECTURE = {
  title: "Renal anatomy",
  summaryJson: null,
  module: { slug: "renal" },
  content: "The kidney hosts nephrons filtering blood omega-3 tubule glomerulus cortex medulla.",
};

describe("POST /api/review/cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    mocks.lectureAccess.mockResolvedValue({ ok: true, value: LECTURE });
    mocks.beginGeneration.mockResolvedValue({ kind: "proceed" });
    mocks.reserveSlot.mockResolvedValue({ ok: true });
    mocks.createSourceCase.mockReturnValue({ questions: ["q?"], case: "c", source: "lecture" });
    mocks.createCase.mockResolvedValue("case-1");
    delete process.env.USE_HOSTED_AI;
    delete process.env.GROQ_API_KEY;
  });

  it("finalizes pending generation as failed when local generation errors (no poisoned idempotency key)", async () => {
    mocks.createSourceCase.mockReturnValue({ questions: [], case: "", source: "lecture" });
    const res = await POST(req({ lectureId: "l1", idempotencyKey: "key-1" }));
    expect(res.status).toBe(400);
    expect(mocks.finalizeGeneration).toHaveBeenCalledWith({
      userId: "student-a",
      idempotencyKey: "key-1",
      status: "failed",
      result: { error: "no_usable_content" },
    });
  });

  it("finalizes pending generation as completed after a successful local generation", async () => {
    const res = await POST(req({ lectureId: "l1", idempotencyKey: "key-2" }));
    expect(res.status).toBe(200);
    expect(mocks.finalizeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "key-2", status: "completed" }),
    );
  });

  it("returns 409 for a concurrent in-flight generation", async () => {
    mocks.beginGeneration.mockResolvedValue({ kind: "pending" });
    const res = await POST(req({ lectureId: "l1", idempotencyKey: "key-3" }));
    expect(res.status).toBe(409);
  });

  it("rejects a mismatched idempotency key as a conflict, not a retry", async () => {
    mocks.beginGeneration.mockResolvedValue({ kind: "conflict" });
    const res = await POST(req({ lectureId: "l1", idempotencyKey: "key-4" }));
    expect(res.status).toBe(409);
  });

  it("returns 429 at the free daily quota", async () => {
    mocks.reserveSlot.mockResolvedValue({ ok: false });
    const res = await POST(req({ lectureId: "l1" }));
    expect(res.status).toBe(429);
  });

  it("denies anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await POST(req({ lectureId: "l1" }));
    expect(res.status).toBe(401);
  });

  it("rejects lectures without readable content", async () => {
    mocks.lectureAccess.mockResolvedValue({ ok: true, value: { ...LECTURE, content: "   " } });
    const res = await POST(req({ lectureId: "l1" }));
    expect(res.status).toBe(400);
  });
});