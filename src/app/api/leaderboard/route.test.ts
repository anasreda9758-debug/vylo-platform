import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getProfile: vi.fn(),
  getXpHistory: vi.fn(),
  getCachedLeaderboard: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/gamification/queries", () => ({
  getProfile: mocks.getProfile,
  getXpHistory: mocks.getXpHistory,
}));
vi.mock("@/shared/query-cache", () => ({ getCachedLeaderboard: mocks.getCachedLeaderboard }));

import { GET } from "./route";

const req = (userId: string | null) => {
  const url = userId ? `http://localhost/api/leaderboard?userId=${encodeURIComponent(userId)}` : "http://localhost/api/leaderboard";
  return new NextRequest(url);
};

describe("GET /api/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    mocks.getProfile.mockResolvedValue({ points: 100 });
    mocks.getXpHistory.mockResolvedValue([{ xp: 5 }]);
    mocks.getCachedLeaderboard.mockResolvedValue([]);
  });

  it("denies anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  it("allows a user to read only their own profile/history by userId", async () => {
    const res = await GET(req("student-a"));
    expect(res.status).toBe(200);
    expect(mocks.getProfile).toHaveBeenCalledWith("student-a");
    expect(mocks.getXpHistory).toHaveBeenCalledWith("student-a");
  });

  it("rejects asking for another user's profile/history (IDOR)", async () => {
    const res = await GET(req("student-b"));
    expect(res.status).toBe(403);
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(mocks.getXpHistory).not.toHaveBeenCalled();
  });
});