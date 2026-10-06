import { describe, expect, it, vi } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  const cards = new Map<string, { dueDate: Date | null; interval: number }>();
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
  let gate: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = gate.then(fn);
    gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const exec = (s: unknown): unknown[] => {
    const { query, values } = parse(s);
    if (query.includes("SELECT due_date FROM flashcard")) {
      const [cardId, userId] = values as [string, string];
      const card = cards.get(`${userId}|${cardId}`);
      return card?.dueDate ? [{ due_date: card.dueDate }] : [];
    }
    if (query.includes("UPDATE flashcard")) {
      const [interval, due, cardId, userId] = values as [number, Date, string, string];
      const k = `${userId}|${cardId}`;
      const existing = cards.get(k);
      if (existing) cards.set(k, { dueDate: due, interval });
      return [];
    }
    throw new Error(`unexpected sql: ${query}`);
  };
  return {
    db: {
      transaction: <T,>(fn: (tx: { execute: (s: unknown) => Promise<unknown[]> }) => Promise<T>) =>
        serial(() => fn({ execute: async (s) => exec(s) })),
    },
    seed: (userId: string, cardId: string, dueDate: Date) =>
      cards.set(`${userId}|${cardId}`, { dueDate, interval: 1 }),
    get: (userId: string, cardId: string) => cards.get(`${userId}|${cardId}`),
  };
});

vi.mock("@/shared/db", () => ({ db: mem.db }));

import { reviewFlashcard } from "@/features/review/queries";

describe("reviewFlashcard - due window policy", () => {
  it("a card due now yields wasDue=true on first review", async () => {
    mem.seed("user-1", "card-1", new Date(Date.now() - 1000));
    const { wasDue } = await reviewFlashcard("card-1", "user-1", "good");
    expect(wasDue).toBe(true);
    expect(mem.get("user-1", "card-1")!.interval).toBe(3);
  });

  it("a card NOT yet due yields wasDue=false (no XP)", async () => {
    mem.seed("user-1", "card-future", new Date(Date.now() + 60 * 60 * 1000));
    const { wasDue } = await reviewFlashcard("card-future", "user-1", "good");
    expect(wasDue).toBe(false);
  });

  it("10 rapid-fire reviews of the same card: only the first is due (wasDue sequence)", async () => {
    mem.seed("user-1", "card-rapid", new Date(Date.now() - 1000));
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const { wasDue } = await reviewFlashcard("card-rapid", "user-1", "good");
      results.push(wasDue);
    }
    expect(results).toEqual([true, false, false, false, false, false, false, false, false, false]);
  });

  it("mini-SRS schedule advances per rating after a due review", async () => {
    mem.seed("user-1", "card-srs", new Date(Date.now() - 1000));
    const t0 = Date.now();
    await reviewFlashcard("card-srs", "user-1", "again");
    const afterAgain = mem.get("user-1", "card-srs")!.dueDate!.getTime() - t0;
    expect(afterAgain).toBeGreaterThanOrEqual(20 * 60 * 60 * 1000); // ~1 day
    expect(afterAgain).toBeLessThan(30 * 60 * 60 * 1000);
  });

  it("10 concurrent reviews of the same due card: exactly one wasDue=true (lock)", async () => {
    mem.seed("user-1", "card-concurrent", new Date(Date.now() - 1000));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reviewFlashcard("card-concurrent", "user-1", "easy")),
    );
    const wins = results.filter((r) => r.wasDue).length;
    expect(wins).toBe(1);
    const next = mem.get("user-1", "card-concurrent")!.dueDate!;
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("cross-user reviews of the same card are independent", async () => {
    mem.seed("user-A", "card-shared", new Date(Date.now() - 1000));
    mem.seed("user-B", "card-shared", new Date(Date.now() - 1000));
    const [a, b] = await Promise.all([
      reviewFlashcard("card-shared", "user-A", "good"),
      reviewFlashcard("card-shared", "user-B", "good"),
    ]);
    expect(a.wasDue).toBe(true);
    expect(b.wasDue).toBe(true);
  });
});