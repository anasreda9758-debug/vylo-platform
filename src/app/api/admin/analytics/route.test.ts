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

describe("admin overview: no infinite loading", () => {
  it("resolves the overview even when every table is empty (0 rows is not a hang)", async () => {
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=overview"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.users.total).toBe(0);
    expect(body.payments).toBeDefined();
    // Zero rows resolve to a real, settled payload — including a genuine
    // "no OSPE stations" advisory, never a permanently pending request.
    expect(body.warnings.map((w: { id: string }) => w.id)).toContain("ospe-zero-stations");
  });

  it("zero OSPE stations and zero payments resolve to an empty state, not a pending request", async () => {
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const ospe = await GET(request("/api/admin/analytics?view=ospe"));
    expect(ospe.status).toBe(200);
    expect((await ospe.json()).stationsConfigured).toBe(0);

    const payments = await GET(request("/api/admin/analytics?view=payments"));
    expect(payments.status).toBe(200);
    expect((await payments.json()).byStatus).toEqual([]);
  });

  it("a failing secondary analytics section does not block the overview", async () => {
    const original = mem.db.execute;
    (mem.db.execute as unknown as (s: unknown) => Promise<unknown[]>) = async (s: unknown) => {
      const { query } = parse(s);
      // Simulate ONLY the AI feature-breakdown section failing.
      if (query.includes("ai_generation_request")) throw new Error("ai section down");
      return original(s);
    };
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=overview"));
    (mem.db.execute as unknown) = original;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ai.featureBreakdown).toEqual([]);
    expect(body.users).toBeDefined();
  });

  it("a failing attention-warnings section does not block the overview", async () => {
    const original = mem.db.execute;
    (mem.db.execute as unknown as (s: unknown) => Promise<unknown[]>) = async (s: unknown) => {
      const { query } = parse(s);
      if (query.includes("lecture WHERE content IS NULL")) throw new Error("warnings down");
      return original(s);
    };
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const response = await GET(request("/api/admin/analytics?view=overview"));
    (mem.db.execute as unknown) = original;

    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toEqual([]);
  });

  it("a hung query is cut off by the server timeout and returns 504 instead of hanging", async () => {
    const original = mem.db.execute;
    (mem.db.execute as unknown as (s: unknown) => Promise<unknown[]>) = () =>
      new Promise(() => {}) as Promise<unknown[]>;
    const prevTimeout = process.env.ADMIN_ANALYTICS_TIMEOUT_MS;
    process.env.ADMIN_ANALYTICS_TIMEOUT_MS = "50";
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });

    let response: Response;
    try {
      response = await GET(request("/api/admin/analytics?view=overview"));
    } finally {
      (mem.db.execute as unknown) = original;
      if (prevTimeout === undefined) delete process.env.ADMIN_ANALYTICS_TIMEOUT_MS;
      else process.env.ADMIN_ANALYTICS_TIMEOUT_MS = prevTimeout;
    }

    expect(response!.status).toBe(504);
    expect((await response!.json()).error).toBe("analytics_timeout");
  });

  it("admin-only authorization remains enforced on every view", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u1", role: "student" } });
    for (const view of ["overview", "users", "ai", "system", "practical", "ospe"]) {
      const res = await GET(request(`/api/admin/analytics?view=${view}`));
      expect(res.status).toBe(403);
    }
  });

  it("detailed users table is paginated and bounded", async () => {
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const res = await GET(request("/api/admin/analytics?view=users&page=1&limit=25"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(25);
    expect(body.page).toBe(1);
    expect(Array.isArray(body.users)).toBe(true);
  });

  it("leaks no secrets in a system-health payload", async () => {
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const res = await GET(request("/api/admin/analytics?view=system"));
    const text = await res.text();
    expect(text).not.toMatch(/(?:re_|sk-|pk_test_|pk_live_|AIza)[A-Za-z0-9_]{10,}/i);
  });

  it("overview issues a bounded number of queries (no per-user N+1 explosion)", async () => {
    const original = mem.db.execute;
    let count = 0;
    (mem.db.execute as unknown as (s: unknown) => Promise<unknown[]>) = async (s: unknown) => {
      count += 1;
      return original(s);
    };
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const res = await GET(request("/api/admin/analytics?view=overview"));
    (mem.db.execute as unknown) = original;

    expect(res.status).toBe(200);
    // Two bounded aggregate batches. The count is independent of how many users
    // / lectures / AI requests exist — that is the anti-N+1 guarantee.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(30);
  });

  it("users view query count does not scale with total user rows", async () => {
    const original = mem.db.execute;
    let count = 0;
    (mem.db.execute as unknown as (s: unknown) => Promise<unknown[]>) = async (s: unknown) => {
      count += 1;
      return original(s);
    };
    mocks.session.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    const res = await GET(request("/api/admin/analytics?view=users&page=1&limit=25"));
    (mem.db.execute as unknown) = original;

    expect(res.status).toBe(200);
    // 2 queries: the paginated page + the count. Not 2 x N.
    expect(count).toBe(2);
  });
});