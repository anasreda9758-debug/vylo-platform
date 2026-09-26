import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const parse = (s: unknown): SqlObj => {
  const o = s as { queryChunks?: unknown[] };
  if (o && Array.isArray(o.queryChunks)) {
    const frags: string[] = [];
    const values: unknown[] = [];
    for (const c of o.queryChunks) {
      const anyC = c as { value?: unknown };
      if (anyC && typeof anyC === "object" && Array.isArray(anyC.value)) {
        frags.push((anyC.value as unknown[]).join(""));
      } else {
        values.push(c);
        frags.push(`$${values.length}`);
      }
    }
    return { query: frags.join(""), values };
  }
  const raw = s as SqlObj;
  return { query: String(raw.query ?? raw), values: raw.values ?? [] };
};

const mem = vi.hoisted(() => {
  const seeded = new Map<string, unknown[]>();
  const exec = async (s: unknown): Promise<unknown[]> => {
    const { query } = parse(s);
    for (const [sub, rows] of seeded) {
      if (query.includes(sub)) return rows;
    }
    return [];
  };
  return {
    db: { execute: exec, query: {}, select: {}, insert: () => ({}) },
    seed: (sub: string, rows: unknown[]) => seeded.set(sub, rows),
    reset: () => seeded.clear(),
  };
});

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
}));

vi.mock("@/shared/db", () => ({ db: mem.db }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));

import { GET } from "./route";

function request(url: string) {
  return new NextRequest(`http://localhost${url}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mem.reset();
});

describe("GET /api/admin/analytics", () => {
  it("rejects unauthenticated requests (401)", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await GET(request("/api/admin/analytics?view=overview"));
    expect(response.status).toBe(401);
  });

  it("rejects non-admins (403)", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user-1", role: "student" } });
    const response = await GET(request("/api/admin/analytics?view=overview"));
    expect(response.status).toBe(403);
  });

  it("rejects unknown views (400)", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=nope"));
    expect(response.status).toBe(400);
  });

  it("overview aggregates user counts into KPI totals", async () => {
    mem.seed('(SELECT count(*)::int FROM "user") AS total', [{ total: 5, admins: 1, students: 4, new_today: 2 }]);
    mocks.session.mockResolvedValue({ user: { id: "system", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=overview"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.users.total).toBe(5);
    expect(body.users.admins).toBe(1);
    expect(body.users.students).toBe(4);
    expect(body.users.newToday).toBe(2);
    expect(body.payments).toBeDefined();
  });

  it("handles db errors as a 500 rather than leaking internals", async () => {
    const original = mem.db.execute;
    (mem.db.execute as unknown as (s: unknown) => Promise<unknown[]>) = async () => {
      throw new Error("db down");
    };
    mocks.session.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=overview"));
    (mem.db.execute as unknown) = original;
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(Object.keys(body)).toContain("error");
    expect(JSON.stringify(body)).not.toContain("db down");
  });

  it("audit view defaults to a wide window and returns rows + total", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    mocks.session.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=audit"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.logs).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("system view never exposes raw env values, only booleans", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=system"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("git");
    expect(text).not.toMatch(/(?:re_|sk-|pk_test_|pk_live_|AIza)[A-Za-z0-9_]{10,}/i);
  });
});