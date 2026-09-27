import { describe, expect, it } from "vitest";
import {
  computeCapacity,
  dedupeCandidates,
  deriveQuestionsFromFacts,
  duplicateSignature,
  normalise,
  renderCapacityMarkdown,
  TARGET_APPROVED_PER_MODULE,
  PREFERRED_CANDIDATE_POOL,
  type CandidateQuestion,
  type FactAtom,
} from "./capacity";
import { buildPools, buildFiveChoices } from "./distractors";

const fact = (over: Partial<FactAtom> = {}): FactAtom => ({
  id: "ak:img1",
  structure: "Circumflex artery",
  category: "ARTERY",
  subject: "Cardio-Vascular System",
  sourcePdf: "OSPE CVS.pdf",
  sourcePage: null,
  sourceImage: "OSPE CVS-100.jpg",
  relation: null,
  answerVerified: true,
  ...over,
});

const five = { options: ["A", "B", "C", "D", "E"], correctOptionId: "a", warnings: [] as string[] };
const noOpts = { options: [] as string[], correctOptionId: null, warnings: ["insufficient"] };

const cand = (over: Partial<CandidateQuestion> = {}): CandidateQuestion => ({
  id: "q1",
  factIds: ["ak:img1"],
  stem: "Identify the marked artery.",
  semanticType: "IDENTIFICATION",
  correctAnswer: "Circumflex artery",
  sourceImage: "OSPE CVS-100.jpg",
  options: [],
  correctOptionId: null,
  tier: "A_SOURCE_VERIFIED",
  warnings: [],
  ...over,
});

describe("1/2. fact atoms and fact-referencing questions", () => {
  it("derives an identification question citing its fact id", () => {
    const out = deriveQuestionsFromFacts([fact()], { makeOptions: () => five });
    expect(out).toHaveLength(1);
    expect(out[0].factIds).toEqual(["ak:img1"]);
    expect(out[0].correctAnswer).toBe("Circumflex artery");
    expect(out[0].semanticType).toBe("IDENTIFICATION");
  });
  it("refuses to derive anything from an unverified atom", () => {
    expect(deriveQuestionsFromFacts([fact({ answerVerified: false })], { makeOptions: () => five })).toHaveLength(0);
    expect(deriveQuestionsFromFacts([fact({ structure: "  " })], { makeOptions: () => five })).toHaveLength(0);
  });
  it("derives a relation question only when the source states the relation", () => {
    const withRel = deriveQuestionsFromFacts([fact({ relation: { kind: "BRANCH_OF", target: "Left coronary artery" } })], { makeOptions: () => five });
    expect(withRel).toHaveLength(2);
    expect(withRel[1].semanticType).toBe("RELATION");
    expect(withRel[1].correctAnswer).toBe("Left coronary artery");
    expect(deriveQuestionsFromFacts([fact()], { makeOptions: () => five })).toHaveLength(1);
  });
});

describe("3/4/6. semantic deduplication", () => {
  it("collapses the same fact + same task even when wording differs", () => {
    const a = cand({ id: "a", stem: "Identify the marked artery." });
    const b = cand({ id: "b", stem: "Which artery is indicated here?" });
    const { unique, duplicates } = dedupeCandidates([a, b]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
  it("keeps identification and relation on the same fact distinct", () => {
    const a = cand({ id: "a", semanticType: "IDENTIFICATION" });
    const b = cand({ id: "b", semanticType: "RELATION" });
    expect(dedupeCandidates([a, b]).unique).toHaveLength(2);
  });
  it("keeps different source images on the same structure distinct", () => {
    const a = cand({ id: "a", sourceImage: "img1.jpg" });
    const b = cand({ id: "b", sourceImage: "img2.jpg" });
    expect(dedupeCandidates([a, b]).unique).toHaveLength(2);
  });
  it("does not count an option shuffle as a new question", () => {
    const a = cand({ options: ["a", "b", "c", "d", "e"] });
    const b = cand({ options: ["e", "c", "a", "d", "b"] });
    expect(duplicateSignature(a)).toBe(duplicateSignature(b));
    expect(dedupeCandidates([a, b]).duplicates).toBe(1);
  });
  it("normalises punctuation and case when comparing", () => {
    expect(normalise("Circumflex Artery, ")).toBe("circumflex artery");
  });
});

describe("8/9/10. five options and distractor rules", () => {
  const entries = ["Left coronary artery", "Right coronary artery", "Circumflex artery", "Great cardiac vein", "Middle cardiac vein", "Small cardiac vein"].map((a) => ({
    answer: a,
    category: "ARTERY" as const,
    subject: "Cardio-Vascular System",
    sourcePdf: "OSPE CVS.pdf",
  }));
  const pools = buildPools(entries);

  it("produces exactly five options when the pool is sufficient", () => {
    const r = buildFiveChoices("Circumflex artery", "ARTERY", "Cardio-Vascular System", pools);
    expect(r.options).toHaveLength(5);
  });
  it("downgrades to NEEDS_REVIEW when the pool is too small", () => {
    const out = deriveQuestionsFromFacts([fact()], { makeOptions: () => noOpts });
    expect(out[0].tier).toBe("C_NEEDS_REVIEW");
    expect(out[0].options).toHaveLength(0);
  });
  it("never invents a term outside the verified pool", () => {
    const r = buildFiveChoices("Circumflex artery", "ARTERY", "Cardio-Vascular System", pools);
    if (r.ok) for (const o of r.options) expect(entries.some((e) => e.answer === o)).toBe(true);
  });
});

const build = (n: number) => Array.from({ length: n }, (_, i) => cand({ id: `q${i}`, sourceImage: `img${i}.jpg` }));

describe("11. capacity calculation and shortfall", () => {
  it("computes the gap to the 300 target", () => {
    const r = computeCapacity({ canonicalSourceQuestions: 79, factAtoms: 177, rawCandidates: 259, duplicatesRemoved: 0, unique: build(218) });
    expect(r.totalUniqueUsableCandidates).toBe(218);
    expect(r.targetApproved).toBe(TARGET_APPROVED_PER_MODULE);
    expect(r.gapToTarget).toBe(82);
    expect(r.meetsTarget).toBe(false);
    expect(r.shortfall).toBe(true);
  });
  it("counts only A and B tiers as eventual approved capacity", () => {
    const unique = [
      ...build(10).map((c) => ({ ...c, tier: "A_SOURCE_VERIFIED" as const })),
      ...build(5).map((c) => ({ ...c, tier: "B_DERIVED_VERIFIED" as const })),
      ...build(7).map((c) => ({ ...c, tier: "C_NEEDS_REVIEW" as const })),
      ...build(3).map((c) => ({ ...c, tier: "D_REJECT" as const })),
    ];
    const r = computeCapacity({ canonicalSourceQuestions: 0, factAtoms: 0, rawCandidates: unique.length, duplicatesRemoved: 0, unique });
    expect(r.sourceVerified).toBe(10);
    expect(r.derivedVerified).toBe(5);
    expect(r.needsReview).toBe(7);
    expect(r.rejected).toBe(3);
    expect(r.totalUniqueUsableCandidates).toBe(15);
  });
  it("reports the shortfall explicitly instead of padding", () => {
    const r = computeCapacity({ canonicalSourceQuestions: 0, factAtoms: 0, rawCandidates: 1, duplicatesRemoved: 0, unique: build(1) });
    expect(r.shortfall).toBe(true);
    const md = renderCapacityMarkdown(r);
    expect(md).toContain("SOURCE CAPACITY SHORTFALL");
    expect(md).toContain("No questions were fabricated");
  });
  it("measures the gap to the preferred 350 candidate pool", () => {
    const r = computeCapacity({ canonicalSourceQuestions: 0, factAtoms: 0, rawCandidates: 259, duplicatesRemoved: 0, unique: build(259) });
    expect(r.gapToPreferredPool).toBe(PREFERRED_CANDIDATE_POOL - 259);
    expect(r.meetsPreferredPool).toBe(false);
  });
});

describe("13. capacity report output", () => {
  it("renders a markdown capacity report", () => {
    const r = computeCapacity({ canonicalSourceQuestions: 79, factAtoms: 177, rawCandidates: 259, duplicatesRemoved: 0, unique: build(218) });
    const md = renderCapacityMarkdown(r, { sourceNotes: ["note one"] });
    expect(md).toContain("Capacity Model");
    expect(md).toContain("note one");
    expect(md).toContain("Verified fact atoms");
    expect(md).toContain("177");
    expect(md).toContain("Nothing was imported or published");
    expect(md).toContain("SOURCE CAPACITY SHORTFALL");
  });
});
