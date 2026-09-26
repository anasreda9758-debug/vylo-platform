import { describe, expect, it, vi, beforeEach } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  type EvalRow = { caseId: string; userId: string; attemptNumber: number };
  const rows: EvalRow[] = [];
  const reset = () => {
    rows.length = 0;
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
  return {
    db: {
      execute: async (s: unknown) => {
        const { query, values } = parse(s);
        if (query.includes("SELECT COUNT(*)")) {
          const [caseId, userId] = values as [string, string];
          const n = rows.filter((r) => r.caseId === caseId && r.userId === userId).length;
          return [{ n }];
        }
        throw new Error(`unexpected execute: ${query}`);
      },
      insert: () => ({
        values: async (v: unknown) => {
          const val = v as EvalRow;
          if (rows.some((r) => r.caseId === val.caseId && r.userId === val.userId && r.attemptNumber === val.attemptNumber)) {
            throw { code: "23505", constraint: "clinical_case_evaluation_case_user_attempt_unique" };
          }
          rows.push(val);
          return {};
        },
      }),
    },
    count: () => rows.length,
    reset,
  };
});

vi.mock("@/shared/db", () => ({ db: mem.db }));

import { createClinicalCaseEvaluation } from "@/features/review/queries";

describe("createClinicalCaseEvaluation - attempt sequencing", () => {
  beforeEach(() => mem.reset());

  it("numbers 10 evaluations of the same case as attempts 1..10", async () => {
    for (let i = 0; i < 10; i++) {
      const attempt = await createClinicalCaseEvaluation({
        caseId: "case-seq",
        userId: "user-seq",
        answers: ["a1"],
        score: 70 + i,
      });
      expect(attempt).toBe(i + 1);
    }
    expect(mem.count()).toBe(10);
  });

  it("counts evaluations per (case, user) independently", async () => {
    await createClinicalCaseEvaluation({ caseId: "case-x", userId: "user-1", answers: [], score: 50 });
    await createClinicalCaseEvaluation({ caseId: "case-x", userId: "user-1", answers: [], score: 51 });
    await createClinicalCaseEvaluation({ caseId: "case-x", userId: "user-2", answers: [], score: 52 });
    await createClinicalCaseEvaluation({ caseId: "case-y", userId: "user-1", answers: [], score: 53 });
    // attempt numbers: user-1/case-x => 1,2 ; user-2/case-x => 1 ; user-1/case-y => 1
    expect(mem.count()).toBe(4);
  });

  it("cross-user attempts of the same case do not collide", async () => {
    await createClinicalCaseEvaluation({ caseId: "case-shared", userId: "user-A", answers: [], score: 40 });
    const b = await createClinicalCaseEvaluation({ caseId: "case-shared", userId: "user-B", answers: [], score: 41 });
    expect(b).toBe(1);
    expect(mem.count()).toBe(2);
  });
});