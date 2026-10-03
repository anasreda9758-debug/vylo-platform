import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/shared/db", () => ({
  db: {
    transaction: mocks.transaction,
    insert: mocks.insert,
    update: mocks.update,
    execute: mocks.execute,
    select: mocks.select,
    query: { promoCode: { findFirst: mocks.findFirst } },
  },
}));

import { POST } from "./route";

const confirmBody = { code: "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY", action: "confirm" };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/redeem", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user-1" } });
});

describe("POST /api/redeem — redemption temporarily disabled", () => {
  it("returns an explicit service-unavailable response for confirm", async () => {
    const response = await POST(request(confirmBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Promo code redemption is temporarily unavailable.",
    });
  });

  it("cannot create subscriptions, promo usage, or redemption records", async () => {
    await POST(request(confirmBody));
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("preserves authentication and never writes for anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request(confirmBody));
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the read-only preview available without writing", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(request({ ...confirmBody, action: "preview" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
