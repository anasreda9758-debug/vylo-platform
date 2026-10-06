import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reviewFlashcard: vi.fn(),
  awardXp: vi.fn(),
  access: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/review/queries", () => ({
  reviewFlashcard: mocks.reviewFlashcard,
}));
vi.mock("@/features/gamification/queries", () => ({ awardXp: mocks.awardXp }));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleFlashcard: mocks.access,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/review/flashcards/review", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user-1" } });
  mocks.access.mockResolvedValue({ ok: true });
  mocks.awardXp.mockResolvedValue({ amount: 2, reason: "flashcard_review" });
});

describe("POST /api/review/flashcards/review", () => {
  it("awards +2 XP only when the card was due at review time", async () => {
    mocks.reviewFlashcard.mockResolvedValue({ wasDue: true });
    const response = await POST(request({ cardId: "card-1", rating: "good" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, xpEarned: true });
    expect(mocks.awardXp).toHaveBeenCalledTimes(1);
    expect(mocks.awardXp).toHaveBeenCalledWith("user-1", "flashcard_review", "card-1");
  });

  it("reviews a card that is NOT due: schedule updates but NO XP", async () => {
    mocks.reviewFlashcard.mockResolvedValue({ wasDue: false });
    const response = await POST(request({ cardId: "card-2", rating: "good" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, xpEarned: false });
    expect(mocks.awardXp).not.toHaveBeenCalled();
  });

  it("10 not-due reviews never award XP", async () => {
    mocks.reviewFlashcard.mockResolvedValue({ wasDue: false });
    for (let i = 0; i < 10; i++) {
      await POST(request({ cardId: "card-3", rating: "good" }));
    }
    expect(mocks.awardXp).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers with 401", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request({ cardId: "card-1", rating: "good" }));
    expect(response.status).toBe(401);
    expect(mocks.reviewFlashcard).not.toHaveBeenCalled();
  });

  it("rejects an invalid rating", async () => {
    const response = await POST(request({ cardId: "card-1", rating: "expert" }));
    expect(response.status).toBe(400);
    expect(mocks.reviewFlashcard).not.toHaveBeenCalled();
  });

  it("404 when the card is not accessible", async () => {
    mocks.access.mockResolvedValue({ ok: false });
    const response = await POST(request({ cardId: "card-ghost", rating: "good" }));
    expect(response.status).toBe(404);
    expect(mocks.reviewFlashcard).not.toHaveBeenCalled();
  });
});