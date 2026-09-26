import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  type Req = { status: string; resultJson: string | null; completedAt: Date | null };
  const store = new Map<string, Req>();
  const keyOf = (u: string, k: string) => `${u}|${k}`;
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
  const exec = (s: unknown): unknown[] => {
    const { query, values } = parse(s);
    if (query.includes("SELECT status, result_json FROM ai_generation_request")) {
      const [user, key] = values as [string, string];
      const row = store.get(keyOf(user, key));
      return row ? [{ status: row.status, result_json: row.resultJson }] : [];
    }
    if (query.includes("INSERT INTO ai_generation_request")) {
      const [key, user, , lectureId, practicalTrackId] = values as [string, string, string, string | null, string | null];
      const id = keyOf(user, key);
      if (store.has(id)) {
        throw { code: "23505", constraint: "ai_generation_request_user_idempotency_key_unique" };
      }
      store.set(id, { status: "pending", resultJson: null, completedAt: null });
      return [];
    }
    if (query.includes("UPDATE ai_generation_request")) {
      const [status, resultJson, completedAt, user, key] = values as [string, string | null, Date | null, string, string];
      store.set(keyOf(user, key), { status, resultJson, completedAt });
      return [];
    }
    throw new Error(`unexpected sql: ${query}`);
  };
  return {
    db: { execute: async (s: unknown) => exec(s) },
    seed: (user: string, key: string, status: Req["status"], resultJson?: string | null) =>
      store.set(keyOf(user, key), { status, resultJson: resultJson ?? null, completedAt: status === "completed" ? new Date() : null }),
    state: (user: string, key: string) => store.get(keyOf(user, key)),
  };
});

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reserve: vi.fn(),
  record: vi.fn(),
  generate: vi.fn(),
  lectureAccess: vi.fn(),
  createFlashcards: vi.fn(),
}));

vi.mock("@/shared/db", () => ({ db: mem.db }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/ai/queries", () => ({
  reserveAiUsageSlot: mocks.reserve,
  recordAiUsage: mocks.record,
  FREE_DAILY_LIMIT: 15,
}));
vi.mock("@/shared/ai-client", () => ({ generateJson: mocks.generate }));
vi.mock("@/features/review/queries", () => ({
  createFlashcards: mocks.createFlashcards,
  getDueFlashcards: vi.fn(),
}));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleLecture: mocks.lectureAccess,
}));

import { POST } from "./route";

const CONTENT = [
  "Auscultation of the heart is the cornerstone of the cardiac examination for medical students.",
  "The first heart sound marks the closure of the atrioventricular valves during early systole.",
  "The second heart sound is caused by the closure of the semilunar valves at end of systole.",
].join(" ");

const lectureRow = () => ({ id: "lecture-1", title: "Cardiac Auscultation", content: CONTENT, summaryJson: null });

function request(body: unknown) {
  return new NextRequest("http://localhost/api/review/flashcards", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user-1" } });
  mocks.reserve.mockResolvedValue({ ok: true, count: 1 });
  mocks.lectureAccess.mockResolvedValue({ ok: true, value: lectureRow() });
  mocks.createFlashcards.mockResolvedValue(3);
});

describe("POST /api/review/flashcards - idempotent generation", () => {
  it("reusing an idempotency key returns the stored result, no second generation, no second quota charge", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    const first = await POST(request({ lectureId: "lecture-1", idempotencyKey: key }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ count: 3, source: "lecture" });

    const second = await POST(request({ lectureId: "lecture-1", idempotencyKey: key }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ count: 3, source: "lecture", duplicate: true });

    // exactly one generation + exactly one quota reservation
    expect(mocks.createFlashcards).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mem.state("user-1", key)?.status).toBe("completed");
  });

  it("a different idempotency key generates a fresh set", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await POST(request({ lectureId: "lecture-1", idempotencyKey: a }));
    await POST(request({ lectureId: "lecture-1", idempotencyKey: b }));
    expect(mocks.createFlashcards).toHaveBeenCalledTimes(2);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
  });

  it("handles a pending request as generated-in-progress (409)", async () => {
    const key = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mem.seed("user-1", key, "pending");
    const response = await POST(request({ lectureId: "lecture-1", idempotencyKey: key }));
    expect(response.status).toBe(409);
    expect(mocks.createFlashcards).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("regenerates after a failed generation and stores the new result", async () => {
    const key = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    mem.seed("user-1", key, "failed", JSON.stringify({ error: "boom" }));
    const response = await POST(request({ lectureId: "lecture-1", idempotencyKey: key }));
    expect(response.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.createFlashcards).toHaveBeenCalledTimes(1);
    expect(mem.state("user-1", key)?.status).toBe("completed");
    expect(await response.json()).toMatchObject({ count: 3, source: "lecture" });
  });

  it("the same idempotency key is scoped per user (cross-user independence)", async () => {
    const key = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await POST(request({ lectureId: "lecture-1", idempotencyKey: key }));
    mocks.session.mockResolvedValue({ user: { id: "user-2" } });
    const second = await POST(request({ lectureId: "lecture-1", idempotencyKey: key }));
    expect(mocks.createFlashcards).toHaveBeenCalledTimes(2);
    expect((await second.json())).toMatchObject({ count: 3, source: "lecture" });
  });

  it("without an idempotency key the old behavior is preserved (generate each time)", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await POST(request({ lectureId: "lecture-1" }));
      expect(response.status).toBe(200);
    }
    expect(mocks.createFlashcards).toHaveBeenCalledTimes(3);
    expect(mocks.reserve).toHaveBeenCalledTimes(3);
  });
});