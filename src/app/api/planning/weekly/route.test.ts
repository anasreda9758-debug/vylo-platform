import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/shared/session", () => ({ getSession: vi.fn() }));
vi.mock("@/features/planning/queries", () => ({ getWeeklyPlan: vi.fn() }));
vi.mock("@/shared/study-year", () => ({ getSelectedStudyYear: vi.fn().mockResolvedValue(1) }));
vi.mock("@/features/curriculum/academic-curriculum", () => ({ getAcademicStudyYears: vi.fn().mockResolvedValue([1]) }));

const { GET } = await import("./route");
const { getSession } = await import("@/shared/session");
const { getWeeklyPlan } = await import("@/features/planning/queries");

const mkReq = (query = "") =>
  ({ nextUrl: { searchParams: new URLSearchParams(query) } }) as never;

const emptyPlan = {
  days: [], totalMinutes: 0, isEmpty: true, notes: ["You are up to date."],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/planning/weekly", () => {
  it("rejects an unauthenticated request", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const res = await GET(mkReq());
    expect(res.status).toBe(401);
  });

  it("returns a plan for a signed-in student", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(getWeeklyPlan).mockResolvedValue(emptyPlan as never);
    const res = await GET(mkReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { isEmpty: boolean } };
    expect(body.plan.isEmpty).toBe(true);
  });

  it("validates dailyMinutes instead of trusting the browser", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await GET(mkReq("dailyMinutes=99999"));
    expect(res.status).toBe(400);
  });

  it("never leaves the client spinning: a failure becomes a 500 with a message", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(getWeeklyPlan).mockRejectedValue(new Error("db down"));
    const res = await GET(mkReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/retry/i);
  });
});
