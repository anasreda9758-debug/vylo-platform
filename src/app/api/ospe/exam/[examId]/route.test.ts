import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), answer: vi.fn(), finish: vi.fn() }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/access/learning-access", () => ({ getAccessibleOspeExam: mocks.access }));
vi.mock("@/features/ospe/exam", () => ({ submitStationAnswer: mocks.answer, finishExam: mocks.finish }));
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ examId: "exam" }) };
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.access.mockResolvedValue({ ok: true, value: { id: "exam", status: "in_progress", startedAt: null, stationCount: 1, timePerStationSec: 60, totalTimeLimitSec: 60, totalScore: 9, maxPossibleScore: 10, stations: [{ id: "s", order: 0, folder: "RENAL", fileName: "image.png", studentAnswer: null, timeSpentSec: null, score: 9, answerKeyId: "secret" }] } });
  mocks.answer.mockResolvedValue({ score: 9, maxScore: 10, explanation: "secret" });
});
describe("OSPE exam HTTP responses", () => {
  it("GET omits active station and total scores", async () => {
    const response = await GET(new NextRequest("http://localhost/api/ospe/exam/exam"), ctx);
    const body = await response.json();
    expect(body.exam).not.toHaveProperty("totalScore"); expect(body.exam.stations[0]).not.toHaveProperty("score"); expect(body.exam.stations[0]).not.toHaveProperty("answerKeyId");
  });
  it("POST acknowledges a saved answer without leaking grading results", async () => {
    const response = await POST(new NextRequest("http://localhost/api/ospe/exam/exam", { method: "POST", body: JSON.stringify({ action: "answer", stationId: "s", answer: "answer" }) }), ctx);
    expect(await response.json()).toEqual({ ok: true, saved: true, stationId: "s" });
  });
  it("does not acknowledge failed persistence", async () => {
    mocks.answer.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(new NextRequest("http://localhost/api/ospe/exam/exam", { method: "POST", body: JSON.stringify({ action: "answer", stationId: "s", answer: "answer" }) }), ctx);
    expect(response.status).toBe(400); expect(await response.json()).not.toHaveProperty("saved");
  });
  it("retains authentication and cross-user denial", async () => {
    mocks.access.mockResolvedValue({ ok: false });
    expect((await GET(new NextRequest("http://localhost/api/ospe/exam/exam"), ctx)).status).toBe(404);
    mocks.session.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/ospe/exam/exam"), ctx)).status).toBe(401);
  });
});
