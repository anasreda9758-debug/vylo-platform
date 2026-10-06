import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  execute: vi.fn(),
  setPayload: vi.fn(() => ({ where: mocks.whereDone })),
  whereDone: vi.fn(),
  insertValues: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/curriculum/schema", () => ({
  lecture: {
    $inferInsert: {},
    id: "id",
    moduleId: "module_id",
    title: "title",
    slug: "slug",
    summary: "summary",
    subject: "subject",
    kind: "kind",
    content: "content",
    pdfFile: "pdf_file",
    order: "order",
    durationMin: "duration_min",
    pdfPageStart: "pdf_page_start",
    pdfPageEnd: "pdf_page_end",
  },
}));
vi.mock("@/shared/db", () => ({
  db: {
    execute: mocks.execute,
    update: () => ({
      set: mocks.setPayload,
      where: mocks.whereDone,
    }),
    insert: () => ({ values: mocks.insertValues }),
  },
}));
vi.mock("@/features/hierarchy/audit", () => ({ logAudit: mocks.audit }));

import { PUT } from "./route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/lectures", {
    method: "PUT",
    body: JSON.stringify(body),
  });

const adminSession = { user: { id: "admin-1", name: "Admin", role: "admin" } };

describe("PUT /api/admin/lectures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(adminSession);
    mocks.execute.mockResolvedValue([{ title: "Old title" }]);
    mocks.whereDone.mockResolvedValue(undefined);
  });

  it("denies non-admin callers", async () => {
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    const res = await PUT(req({ id: "l1", title: "x" }));
    expect(res.status).toBe(403);
    expect(mocks.setPayload).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent lecture", async () => {
    mocks.execute.mockResolvedValue([]);
    const res = await PUT(req({ id: "nope", title: "x" }));
    expect(res.status).toBe(404);
  });

  it("rejects a non-integer durationMin", async () => {
    const res = await PUT(req({ id: "l1", durationMin: "sixty" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string title", async () => {
    const res = await PUT(req({ id: "l1", title: 42 }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer order", async () => {
    const res = await PUT(req({ id: "l1", order: 2.5 }));
    expect(res.status).toBe(400);
  });

  it("writes updates through parameterized Drizzle, not string-built SQL", async () => {
    const res = await PUT(req({ id: "l1", title: "New", durationMin: 45 }));
    expect(res.status).toBe(200);
    expect(mocks.setPayload).toHaveBeenCalledWith({ title: "New", durationMin: 45 });
    expect(mocks.whereDone).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("clears nullable fields with explicit null", async () => {
    const res = await PUT(req({ id: "l1", summary: null }));
    expect(res.status).toBe(200);
    expect(mocks.setPayload).toHaveBeenCalledWith({ summary: null });
  });
});