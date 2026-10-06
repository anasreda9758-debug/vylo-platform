import { describe, expect, it, vi, beforeEach } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  const xpLog = new Map<string, number>();
  const profile = new Map<string, { total_xp: number; level: number; streak: number }>();
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
  const defer = <T,>(v: T): Promise<T> => Promise.resolve(v);

  const unsafe = async (s: unknown): Promise<unknown[]> => {
    const { query, values } = parse(s);
    if (query.includes("INSERT INTO xp_log")) {
      const [user, amount, reason, ref] = values as [string, number, string, string | null];
      const k = `${user}|${reason}|${ref ?? ""}`;
      const onceEver = reason === "case_complete" || reason === "lecture_complete";
      if (onceEver && xpLog.has(k)) {
        throw {
          code: "23505",
          constraint: reason === "case_complete" ? "xp_log_user_case_complete_unique" : "xp_log_user_lecture_complete_unique",
        };
      }
      xpLog.set(k, amount);
      return [];
    }
    if (query.includes("SELECT total_xp FROM user_profile")) {
      const [user] = values as [string];
      return [profile.get(user) ?? { total_xp: 0, level: 1, streak: 1 }];
    }
    if (query.includes("INSERT INTO user_profile")) {
      const [user, total_xp, level, streak] = values as [string, number, number, number];
      profile.set(user, { total_xp, level, streak });
      return [];
    }
    if (query.includes("SELECT total_xp, level, streak")) {
      const [user] = values as [string];
      return [profile.get(user) ?? { total_xp: 0, level: 1, streak: 1 }];
    }
    if (query.includes("SELECT 1 FROM xp_log")) {
      const [user, ref] = values as [string, string];
      return xpLog.has(`${user}|case_complete|${ref ?? ""}`) ? [{ exists: 1 }] : [];
    }
    return [];
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

  return {
    db: {
      execute: (s: unknown) => defer(unsafe(s)),
    },
    client: {
      begin: <T,>(fn: (tx: { unsafe: typeof unsafe }) => Promise<T>) => serial(() => fn({ unsafe })),
    },
    awardedCount: () => xpLog.size,
    reset: () => {
      xpLog.clear();
      profile.clear();
    },
  };
});

vi.mock("@/shared/db", () => ({ db: mem.db, client: mem.client }));

import { awardXp, hasEarnedCaseCompletionXp } from "@/features/gamification/queries";
import { safeAwardXpGeneral } from "@/features/gamification/error-handling";

describe("case_complete XP - once-ever ledger", () => {
  beforeEach(() => {
    mem.reset();
  });

  it("10 evaluations of the same case => exactly one XP award of +15", async () => {
    let result;
    for (let i = 0; i < 10; i++) {
      result = await safeAwardXpGeneral(
        () => awardXp("case-xp-user", "case_complete", "case-1"),
        (msg, err) => console.warn(`[case_complete] ${msg}`, err),
      );
      expect(result?.amount).toBe(15);
      if (i === 0) {
        expect(result?.alreadyAwarded).toBeUndefined();
        expect(result?.totalXp).toBe(15);
      } else {
        expect(result?.alreadyAwarded).toBe(true);
        expect(result?.totalXp).toBe(15);
      }
    }
    expect(mem.awardedCount()).toBe(1);
    expect(await hasEarnedCaseCompletionXp("case-xp-user", "case-1")).toBe(true);
  });

  it("cross-user independence: both users earn +15 for the same case", async () => {
    const a = await awardXp("case-xp-userA", "case_complete", "case-shared");
    const b = await awardXp("case-xp-userB", "case_complete", "case-shared");
    expect(a.totalXp).toBe(15);
    expect(b.totalXp).toBe(15);
    expect(mem.awardedCount()).toBe(2);
  });

  it("a different case is independent: case-1 then case-2 => +30", async () => {
    await awardXp("case-xp-userC", "case_complete", "case-c1");
    const second = await awardXp("case-xp-userC", "case_complete", "case-c2");
    expect(second.totalXp).toBe(30);
  });

  it("10 concurrent evaluations of the same case => exactly one winner (atomic)", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => awardXp("case-xp-concurrent", "case_complete", "case-x")),
    );
    const winners = results.filter((r) => r.totalXp === 15 && !r.alreadyAwarded).length;
    const dups = results.filter((r) => r.alreadyAwarded === true).length;
    expect(winners).toBe(1);
    expect(dups).toBe(9);
    for (const r of results) {
      expect(r.totalXp).toBe(15);
      expect(r.amount).toBe(15);
    }
  });

  it("recognizes the case_complete unique constraint as an expected duplicate", async () => {
    const first = await awardXp("case-xp-dup", "case_complete", "case-d");
    const second = await awardXp("case-xp-dup", "case_complete", "case-d");
    expect(first.alreadyAwarded).toBeUndefined();
    expect(second.alreadyAwarded).toBe(true);
  });
});

describe("case_complete XP - unrelated reasons still award", () => {
  it("flashcard_review is not once-ever at the ledger level (route gates by due)", async () => {
    const card = "card-repeat";
    const a = await awardXp("case-xp-other", "flashcard_review", card);
    await awardXp("case-xp-other", "flashcard_review", card);
    const c = await awardXp("case-xp-other", "flashcard_review", card);
    expect(a.amount).toBe(2);
    expect(a.alreadyAwarded).toBeUndefined();
    expect(c.totalXp).toBe(6);
    expect(c.alreadyAwarded).toBeUndefined();
  });
});