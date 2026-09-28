import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  setPayload: vi.fn(() => ({ where: mocks.whereDone })),
  whereDone: vi.fn(),
  execute: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/curriculum/schema", () => ({
  curriculumModule: { id: "id", order: "order" },
  lecture: { id: "id", order: "order" },
}));
vi.mock("@/shared/db", () => ({
  db: {
    update: () => ({
      set: mocks.setPayload,
      where: mocks.whereDone,
    }),
    execute: mocks.execute,
  },
}));
vi.mock("@/features/hierarchy/audit", () => ({ logAudit: mocks.audit }));

import { POST } from "./route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/reorder", {
    method: "POST",
    body: JSON.stringify(body),
  });

const adminSession = { user: { id: "admin-1", name: "Admin", role: "admin" } };

describe("POST /api/admin/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(adminSession);
    mocks.whereDone.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue([]);
  });

  it("denies non-admin callers", async () => {
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    const res = await POST(req({ entityType: "module", items: [{ id: "m1", order: 1 }] }));
    expect(res.status).toBe(403);
    expect(mocks.setPayload).not.toHaveBeenCalled();
  });

  it("rejects an unknown entityType", async () => {
    const res = await POST(req({ entityType: "DROP TABLE", items: [{ id: "m1", order: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("rejects empty items", async () => {
    const res = await POST(req({ entityType: "module", items: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer order", async () => {
    const res = await POST(req({ entityType: "module", items: [{ id: "m1", order: 1.5 }] }));
    expect(res.status).toBe(400);
  });

  it("writes with parameterized updates, never raw SQL", async () => {
    const res = await POST(req({ entityType: "module", items: [{ id: "m1", order: 3 }] }));
    expect(res.status).toBe(200);
    expect(mocks.setPayload).toHaveBeenCalledWith({ order: 3 });
    expect(mocks.whereDone).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});