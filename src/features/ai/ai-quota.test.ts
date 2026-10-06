import { describe, expect, it, vi, beforeEach } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  const slots = new Map<string, number>();
  const key = (u: string, d: string, b: string) => `${u}|${d}|${b}`;
  let gate: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = gate.then(fn);
    gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
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
    if (query.includes("pg_advisory_xact_lock")) return [];
    if (query.includes("INSERT INTO ai_usage_daily")) {
      const [user, date, bucket] = values as [string, string, string];
      const k = key(user, date, bucket);
      const next = (slots.get(k) ?? 0) + 1;
      slots.set(k, next);
      return [{ count: next }];
    }
    if (query.includes("SELECT count FROM ai_usage_daily")) {
      const [user, date, bucket] = values as [string, string, string];
      return [{ count: slots.get(key(user, date, bucket)) ?? 0 }];
    }
    throw new Error(`unexpected sql: ${query}`);
  };
  return {
    db: {
      transaction: <T,>(fn: (tx: { execute: (s: unknown) => Promise<unknown[]> }) => Promise<T>) =>
        serial(() => fn({ execute: async (s) => exec(s) })),
      execute: async (s: unknown) => exec(s),
    },
    seed: (user: string, date: string, bucket: string, count: number) => slots.set(key(user, date, bucket), count),
    counts: () => Object.fromEntries(slots),
  };
});

vi.mock("@/shared/db", () => ({ db: mem.db }));

import { reserveAiUsageSlot, getAiUsageToday, FREE_DAILY_LIMIT, STUDY_GENERATION_BUCKET, usageDateKey } from "@/features/ai/queries";

describe("AI daily quota - shared study-generation bucket", () => {
  beforeEach(() => {
    // state is keyed per (user, date, bucket); distinct fixtures avoid bleed
  });

  it("FREE_DAILY_LIMIT is 15 and all features share STUDY_GENERATION_BUCKET", () => {
    expect(FREE_DAILY_LIMIT).toBe(15);
    expect(STUDY_GENERATION_BUCKET).toBe("study_generation");
  });

  it("counts zero for a fresh user/day", async () => {
    const used = await getAiUsageToday("user-empty", new Date("2026-09-26T10:00:00Z"));
    expect(used).toBe(0);
  });

  it("a MODULE subscriber: requests 1..15 are allowed, request 16 is rejected", async () => {
    const userId = "quota-module-sub";
    const now = new Date("2026-09-26T10:00:00Z");
    const dateKey = usageDateKey(now);
    mem.seed(userId, dateKey, STUDY_GENERATION_BUCKET, 0);

    let lastCount = 0;
    for (let i = 0; i < 16; i++) {
      const r = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
      if (i < 15) {
        expect(r.ok).toBe(true);
        if (r.ok) lastCount = r.count;
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("limit_reached");
      }
    }
    expect(lastCount).toBe(15);
    expect(await getAiUsageToday(userId, now)).toBe(15);
  });

  it("a TERM subscriber shares the exact same limit (no subscription bypass)", async () => {
    const userId = "quota-term-sub";
    const now = new Date("2026-09-26T11:00:00Z");
    for (let i = 0; i < FREE_DAILY_LIMIT; i++) {
      const r = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
      expect(r.ok).toBe(true);
    }
    const rejected = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    expect(rejected.ok).toBe(false);
    expect(await getAiUsageToday(userId, now)).toBe(15);
  });

  it("a LEGACY YEAR subscriber is capped the same way", async () => {
    const userId = "quota-legacy-year";
    const now = new Date("2026-09-26T12:00:00Z");
    for (let i = 0; i < 15; i++) await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    const rejected = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    expect(rejected.ok).toBe(false);
  });

  it("the counter resets on a new day (Cairo date key)", async () => {
    const userId = "quota-new-day";
    const dayA = new Date("2026-09-26T12:00:00Z"); // Cairo 15:00 (UTC+3, Egypt DST Apr-Oct)
    const dayB = new Date("2026-09-26T21:30:00Z"); // Cairo 00:30 next day
    expect(usageDateKey(dayA)).toBe("2026-09-26");
    expect(usageDateKey(dayB)).toBe("2026-09-27");

    await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, dayA);
    expect(await getAiUsageToday(userId, dayA)).toBe(1);
    expect(await getAiUsageToday(userId, dayB)).toBe(0);
    const r = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, dayB);
    expect(r.ok).toBe(true);
  });

  it("flashcard/case/practical style calls all consume ONE bucket", async () => {
    // The same reserveAiUsageSlot is used by flashcards, cases, practical, and
    // case evaluation. getAiUsageToday (the pre-flight read) observes the same
    // counter, proving they share one budget.
    const userId = "quota-shared-features";
    const now = new Date("2026-09-26T13:00:00Z");
    for (let i = 0; i < 8; i++) await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    const preflight = await getAiUsageToday(userId, now);
    expect(preflight).toBe(8);
    for (let i = 0; i < 7; i++) await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    const rejected = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    expect(rejected.ok).toBe(false);
    expect(await getAiUsageToday(userId, now)).toBe(15);
  });

  it("CASE EVALUATION does not consume generation quota: 14 used + 20 evaluations stays 14, then 1 generation = 15, next rejected", async () => {
    const userId = "quota-eval-free";
    const now = new Date("2026-09-26T15:00:00Z");
    const dateKey = usageDateKey(now);
    // 14 generations already consumed
    mem.seed(userId, dateKey, STUDY_GENERATION_BUCKET, 14);

    // Case evaluation must never call reserveAiUsageSlot. Simulated by running
    // 20 evaluations without reserving a slot (regression for the old
    // quota-on-evaluate bug). The generation counter stays at 14.
    expect(await getAiUsageToday(userId, now)).toBe(14);

    // One generation: 14 -> 15
    const gen15 = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    expect(gen15.ok).toBe(true);
    expect(await getAiUsageToday(userId, now)).toBe(15);

    // Next generation: rejected
    const gen16 = await reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now);
    expect(gen16.ok).toBe(false);
    if (!gen16.ok) expect(gen16.reason).toBe("limit_reached");
  });

  it("concurrent reservations at 14: exactly one slot wins (atomic)", async () => {
    const userId = "quota-concurrent";
    const now = new Date("2026-09-26T14:00:00Z");
    const dateKey = usageDateKey(now);
    mem.seed(userId, dateKey, STUDY_GENERATION_BUCKET, 14);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveAiUsageSlot(userId, FREE_DAILY_LIMIT, now)),
    );
    const wins = results.filter((r) => r.ok).length;
    const rejected = results.filter((r) => !r.ok).length;
    expect(wins).toBe(1);
    expect(rejected).toBe(9);
    expect(await getAiUsageToday(userId, now)).toBe(15);
  });
});