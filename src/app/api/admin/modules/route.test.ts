import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  execute: vi.fn(),
  setPayload: vi.fn(() => ({ where: mocks.whereDone })),
  whereDone: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/curriculum/schema", () => ({
  curriculumModule: { $inferInsert: {}, id: "id" },
  lecture: { id: "id" },
}));
vi.mock("@/shared/db", () => ({
  db: {
    execute: mocks.execute,
    update: () => ({
      set: mocks.setPayload,
      where: mocks.whereDone,
    }),
  },
}));
vi.mock("@/features/hierarchy/audit", () => ({ logAudit: mocks.audit }));

import { PUT } from "./route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/modules", {
    method: "PUT",
    body: JSON.stringify(body),
  });

const adminSession = { user: { id: "admin-1", name: "Admin", role: "admin" } };

describe("PUT /api/admin/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(adminSession);
    mocks.execute.mockResolvedValue([{ name: "Old", slug: "old" }]);
    mocks.whereDone.mockResolvedValue(undefined);
  });

  it("denies non-admin callers", async () => {
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    const res = await PUT(req({ id: "m1", name: "x" }));
    expect(res.status).toBe(403);
  });

  it("rejects a boolean isFree where a string is required", async () => {
    const res = await PUT(req({ id: "m1", name: "x", isFree: "yes" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer order", async () => {
    const res = await PUT(req({ id: "m1", order: 1.5 }));
    expect(res.status).toBe(400);
  });

  it("writes through parameterized Drizzle only", async () => {
    const res = await PUT(req({ id: "m1", name: "Renal", order: 2, isFree: true }));
    expect(res.status).toBe(200);
    expect(mocks.setPayload).toHaveBeenCalledWith({ name: "Renal", order: 2, isFree: true });
    expect(mocks.whereDone).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});