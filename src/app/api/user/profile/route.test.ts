import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  setPayload: vi.fn(() => ({ where: mocks.whereDone })),
  whereDone: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/auth/schema", () => ({ user: { id: "id" } }));
vi.mock("@/shared/db", () => ({
  db: {
    update: () => ({
      set: mocks.setPayload,
      where: mocks.whereDone,
    }),
  },
}));

import { PUT } from "./route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/user/profile", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("PUT /api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    mocks.whereDone.mockResolvedValue(undefined);
  });

  it("denies anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await PUT(req({ name: "Jay" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON instead of 500", async () => {
    const res = await PUT(req("{not json"));
    expect(res.status).toBe(400);
    expect(mocks.setPayload).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    const res = await PUT(req({ name: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects a name longer than 200 characters", async () => {
    const res = await PUT(req({ name: "j".repeat(201) }));
    expect(res.status).toBe(400);
  });

  it("accepts a bounded name, trimmed", async () => {
    const res = await PUT(req({ name: "  Jay  " }));
    expect(res.status).toBe(200);
    expect(mocks.setPayload).toHaveBeenCalledWith({ name: "Jay" });
  });
});