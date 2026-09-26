import { describe, expect, it, vi, beforeEach } from "vitest";

const mem = vi.hoisted(() => {
  const names = new WeakMap<object, string>();
  const nameOf = (t: unknown): string => (t && typeof t === "object" ? (names.get(t) ?? "") : "");

  const images = new Map<string, Record<string, unknown>>();
  const questions = new Map<string, Record<string, unknown>>();
  const mutations: { table: string; values: Record<string, unknown> }[] = [];

  const rowsFor = (table: unknown): Record<string, unknown>[] =>
    nameOf(table) === "practical_image" ? [...images.values()] : nameOf(table) === "practical_question" ? [...questions.values()] : [];

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async (n?: number) => rowsFor(table).slice(0, n ?? 1),
          orderBy: () => rowsFor(table),
        }),
        orderBy: () => rowsFor(table),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mutations.push({ table: nameOf(table), values });
          return [];
        },
      }),
    }),
  };

  return {
    db,
    identify: (table: unknown, name: string) => names.set(table as object, name),
    seedImage: (row: Record<string, unknown>) => images.set(String(row.id), row),
    seedQuestion: (row: Record<string, unknown>) => questions.set(String(row.id), row),
    mutations,
    reset: () => {
      images.clear();
      questions.clear();
      mutations.length = 0;
    },
  };
});

vi.mock("@/shared/db", () => ({ db: mem.db }));

import { buildFiveOptions, normalizeChoice, targetPosition, isApprovalReady, setQuestionStatus } from "./authoring";
import { practicalImage, practicalQuestion } from "./schema";

mem.identify(practicalImage, "practical_image");
mem.identify(practicalQuestion, "practical_question");

describe("normalizeChoice", () => {
  it("collapses case, whitespace and punctuation so duplicates are detected", () => {
    expect(normalizeChoice("  Left  ventricle ")).toBe(normalizeChoice("left ventricle"));
    expect(normalizeChoice("right atrium")).toBe(normalizeChoice("Right Atrium"));
    expect(normalizeChoice("")).toBe("");
  });
});

describe("buildFiveOptions - exactly 5 options, 1 verified correct + 4 distractors", () => {
  const correct = "Primary bronchus";

  it("places the verified structure on opt_0 and never trusts AI for the answer", () => {
    const out = buildFiveOptions(correct, DISTRACTORS);
    expect(out.options).toHaveLength(5);
    expect(out.options[0]).toEqual({ id: "opt_0", text: correct });
    expect(out.correctOptionId).toBe("opt_0");
    expect(out.needsReview).toBe(false);
  });

  it("filters blank/duplicate/correct-valued distractors", () => {
    const out = buildFiveOptions(correct, [
      "Primary bronchus", // duplicates the correct answer
      "Primary bronchus", // again
      "",
      "   ",
      "Bronchiole",
      "Bronchiole", // dup
      "Pulmonary vein",
      "Respiratory bronchiole",
      "Alveolar macrophage",
    ]);
    expect(out.options).toHaveLength(5);
    expect(out.needsReview).toBe(false);
    expect(out.options.map((o) => o.text)).toEqual([
      "Primary bronchus",
      "Bronchiole",
      "Pulmonary vein",
      "Respiratory bronchiole",
      "Alveolar macrophage",
    ]);
  });

  it("flags NEEDS_REVIEW when fewer than four usable distractors arrive (admin completes)", () => {
    const out = buildFiveOptions(correct, ["Bronchiole", "Pulmonary vein"]);
    expect(out.options.length).toBeLessThan(5);
    expect(out.needsReview).toBe(true);
    expect(out.options[0].text).toBe(correct);
  });
});

describe("targetPosition - arrow overlay math", () => {
  const widths = [320, 390, 768, 1024, 1440];
  const x = 0.5;
  const y = 0.25;

  it("keeps the arrow at the SAME percentage across every verified viewport", () => {
    for (const w of widths) {
      for (const h of [w * 0.75, 800]) {
        const pos = targetPosition(x, y, w, h);
        expect(pos.leftPct).toBeCloseTo(50, 6);
        expect(pos.topPct).toBeCloseTo(25, 6);
      }
    }
  });

  it("scales the pixel offset with image size (arrow tip maps correctly)", () => {
    const small = targetPosition(x, y, 320, 240);
    const large = targetPosition(x, y, 1440, 1080);
    expect(small.px).toBe(160);
    expect(small.py).toBe(60);
    expect(large.px).toBe(720);
    expect(large.py).toBe(270);
  });

  it("clamps out-of-range coordinates to the image bounds (0..1)", () => {
    expect(targetPosition(-1, 2, 100, 100)).toEqual({ leftPct: 0, topPct: 100, px: 0, py: 100 });
  });
});

describe("isApprovalReady - the student-visibility gate", () => {
  const five = buildFiveOptions("Primary bronchus", DISTRACTORS).options;
  const base = {
    correctStructure: "Bronchus",
    options: five,
    correctOptionId: "opt_0",
    examImageId: "img-clean-9",
    examStorageKey: "anatomy/lung-clean.png",
  };

  it("approves a complete artifact (verified answer + clean image + 5 options)", () => {
    expect(isApprovalReady(base)).toBe(true);
  });

  it("blocks when the verified structure is missing (AI must never be the answer)", () => {
    expect(isApprovalReady({ ...base, correctStructure: "" })).toBe(false);
    expect(isApprovalReady({ ...base, correctStructure: "   " })).toBe(false);
    expect(isApprovalReady({ ...base, correctStructure: null })).toBe(false);
  });

  it("blocks when no clean EXAM image (or its upload) exists", () => {
    expect(isApprovalReady({ ...base, examImageId: null })).toBe(false);
    expect(isApprovalReady({ ...base, examStorageKey: "" })).toBe(false);
    expect(isApprovalReady({ ...base, examStorageKey: null })).toBe(false);
  });

  it("blocks when the options are not exactly five distinct, non-blank choices", () => {
    expect(isApprovalReady({ ...base, options: base.options.slice(0, 4) })).toBe(false);
    expect(isApprovalReady({ ...base, options: [...base.options, { id: "opt_5", text: "Extra" }] })).toBe(false);
    expect(
      isApprovalReady({ ...base, options: base.options.map((o) => (o.id === "opt_1" ? { ...o, text: "" } : o)) }),
    ).toBe(false);
  });

  it("blocks when more than one option claims to be correct", () => {
    const dup = base.options.map((o, i) => (i === 0 ? o : { ...o, id: "opt_0" }));
    expect(isApprovalReady({ ...base, options: dup })).toBe(false);
  });
});

describe("setQuestionStatus - APPROVED / REJECTED transitions", () => {
  const five = buildFiveOptions("Primary bronchus", DISTRACTORS).options;

  beforeEach(() => {
    mem.reset();
  });

  const readyQuestion = () => ({
    id: "q-1",
    trackId: "track-1",
    options: five,
    correctOptionId: "opt_0",
    correctStructure: "Primary bronchus",
    imageId: "img-clean-9",
    examImageId: "img-clean-9",
    status: "DRAFT_AI",
    reviewStatus: "DRAFT",
  });

  it("approves only when everything the student sees is complete", async () => {
    mem.seedQuestion(readyQuestion());
    mem.seedImage({ id: "img-clean-9", trackId: "track-1", storageKey: "anatomy/lung-clean.png" });

    expect(await setQuestionStatus("q-1", "APPROVED")).toEqual({ ok: true });
    expect(mem.mutations.at(-1)).toMatchObject({ table: "practical_question", values: { status: "APPROVED", reviewStatus: "APPROVED" } });
  });

  it("refuses approval without a verified structure or complete options", async () => {
    const q = readyQuestion();
    q.correctStructure = "";

    mem.seedQuestion(q);
    mem.seedImage({ id: "img-clean-9", trackId: "track-1", storageKey: "anatomy/lung-clean.png" });
    expect(await setQuestionStatus("q-1", "APPROVED")).toEqual({ ok: false, reason: "not_approval_ready" });

    q.correctStructure = "Primary bronchus";
    q.options = q.options.slice(0, 3);
    mem.seedQuestion({ ...q });
    expect(await setQuestionStatus("q-1", "APPROVED")).toEqual({ ok: false, reason: "not_approval_ready" });
  });

  it("refuses approval when the student-facing image has no uploaded clean file", async () => {
    mem.seedQuestion(readyQuestion());
    mem.seedImage({ id: "img-clean-9", trackId: "track-1", storageKey: "" });
    expect(await setQuestionStatus("q-1", "APPROVED")).toEqual({ ok: false, reason: "not_approval_ready" });
  });

  it("refuses approval when question and image disagree on the practical track", async () => {
    mem.seedQuestion({ ...readyQuestion(), trackId: "track-1" });
    mem.seedImage({ id: "img-clean-9", trackId: "track-2", storageKey: "anatomy/lung-clean.png" });
    expect(await setQuestionStatus("q-1", "APPROVED")).toEqual({ ok: false, reason: "not_approval_ready" });

    mem.seedQuestion({ ...readyQuestion(), trackId: "track-1" });
    mem.seedImage({ id: "img-clean-9", trackId: null, storageKey: "anatomy/lung-clean.png" });
    expect(await setQuestionStatus("q-1", "APPROVED")).toEqual({ ok: false, reason: "not_approval_ready" });
  });

  it("REJECTED unapproves without touching the artifact's content", async () => {
    mem.seedQuestion({ ...readyQuestion(), status: "APPROVED", reviewStatus: "APPROVED" });
    expect(await setQuestionStatus("q-1", "REJECTED")).toEqual({ ok: true });
    expect(mem.mutations.at(-1)).toMatchObject({ table: "practical_question", values: { status: "DRAFT_AI", reviewStatus: "REJECTED" } });
  });

  it("returns not_found for an unknown question", async () => {
    expect(await setQuestionStatus("nope", "APPROVED")).toEqual({ ok: false, reason: "not_found" });
  });
});

const DISTRACTORS = [
  "Bronchiole smooth muscle",
  "Alveolar macrophage",
  "Pulmonary vein",
  "Respiratory bronchiole",
];