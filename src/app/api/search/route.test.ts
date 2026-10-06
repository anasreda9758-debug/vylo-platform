import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getRAGIndex: vi.fn(),
  retrieve: vi.fn(),
  findMany: vi.fn(),
  lectureAccess: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/rag", () => ({
  getRAGIndex: mocks.getRAGIndex,
  retrieve: mocks.retrieve,
}));
vi.mock("@/features/curriculum/schema", () => ({ lecture: { id: "id" } }));
vi.mock("@/shared/db", () => ({
  db: { query: { lecture: { findMany: mocks.findMany } } },
}));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleLecture: mocks.lectureAccess,
}));

import { GET } from "./route";

const req = (q: string | null, k?: string, module?: string) => {
  const params = new URLSearchParams();
  if (q !== null) params.set("q", q);
  if (k !== undefined) params.set("k", k);
  if (module) params.set("module", module);
  return new NextRequest(`http://localhost/api/search?${params.toString()}`);
};

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    mocks.getRAGIndex.mockResolvedValue({});
    mocks.retrieve.mockReturnValue([]);
    mocks.findMany.mockResolvedValue([]);
    mocks.lectureAccess.mockResolvedValue({ ok: true, value: { slug: "renal" } });
  });

  it("denies anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(req("kidney"));
    expect(res.status).toBe(401);
  });

  it("rejects a missing query", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(400);
  });

  it("caps the query length at 500 characters", async () => {
    const res = await GET(req("k".repeat(501)));
    expect(res.status).toBe(400);
  });

  it("clamps k to the 1..20 range", async () => {
    const res = await GET(req("kidney", "99999"));
    expect(res.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith(expect.anything(), "kidney", { topK: 20, moduleSlug: undefined });
  });

  it("falls back to 5 when k is not a finite number", async () => {
    const res = await GET(req("kidney", "abc"));
    expect(res.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith(expect.anything(), "kidney", { topK: 5, moduleSlug: undefined });
  });

  it("returns 502 (not 500) when search backing is unavailable", async () => {
    mocks.getRAGIndex.mockRejectedValue(new Error("boom"));
    const res = await GET(req("kidney"));
    expect(res.status).toBe(502);
  });
});