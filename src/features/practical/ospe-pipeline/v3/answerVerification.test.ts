import { describe, expect, it } from "vitest";
import {
  resolveVerifiedAnswer, isAutoVerifiable, verifiedDistractorPool,
  type AnswerKeyRow, type MatchConfidence,
} from "./answerVerification";
import { extractPrintedAnswer } from "./questionBlock";
import type { TextLine } from "./pdfGeometry";

const row = (id: string, diagnosis: string, identification: string | null = null): AnswerKeyRow => ({
  id, folder: "CVS", fileName: `${id}.jpg`, diagnosis, identification,
});

const CVS_KEY: AnswerKeyRow[] = [
  row("1", "Circumflex artery", "Branch of left coronary artery"),
  row("2", "Left atrium", "Posterior chamber"),
  row("3", "Superior vena cava", "Large vein"),
  row("4", "Ascending aorta", "Ascends from LV"),
];

const RESP_KEY: AnswerKeyRow[] = [
  row("r1", "", "Identify the lobes and fissures of the right lung"),
  row("r2", "", "Identify this respiratory tissue"),
];

const line = (text: string, y0: number): TextLine => ({
  text, rect: { x0: 50, y0, x1: 250, y1: y0 + 10 }, fontSize: 12,
  spans: [{ text, rect: { x0: 50, y0, x1: 250, y1: y0 + 10 }, fontSize: 12 }],
});

describe("printed answer recovery (no punctuation assumption)", () => {
  it("recovers an answer with no trailing period", () => {
    expect(extractPrintedAnswer([line("10 ) Identify this vessel :", 159), line("Superior vena cava", 191)], "10 ) Identify this vessel :"))
      .toBe("Superior vena cava");
  });

  it("recovers an answer that ends with a source marker glyph", () => {
    expect(extractPrintedAnswer([line("11 ) Identify this vessel :", 551), line("Pulmonary artery ?", 583)], "11 ) Identify this vessel :"))
      .toBe("Pulmonary artery");
  });

  it("ignores a bare numeric image label", () => {
    const out = extractPrintedAnswer(
      [line("12 ) This point refers to", 159), line("surface anatomy of:", 175), line("Apex of the heart", 208), line("5", 252)],
      "12 ) This point refers to",
    );
    expect(out).toBe("Apex of the heart");
  });

  it("returns null when there is no answer line", () => {
    expect(extractPrintedAnswer([line("1) Identify this:", 100)], "1) Identify this:")).toBeNull();
  });
});

describe("answer verification against the answer key", () => {
  it("EXACT when the printed answer is identical to a key diagnosis", () => {
    const r = resolveVerifiedAnswer("Superior vena cava", CVS_KEY);
    expect(r.confidence).toBe("EXACT");
    expect(r.answer).toBe("Superior vena cava");
    expect(r.verifiedBy).toContain("ANSWER_KEY_DIAGNOSIS");
    expect(r.answerKeyId).toBe("3");
  });

  it("STRONG when it matches after normalisation", () => {
    const r = resolveVerifiedAnswer("superior  vena cava.", CVS_KEY);
    expect(r.confidence).toBe("STRONG");
    expect(isAutoVerifiable(r.confidence)).toBe(true);
  });

  it("STRONG for a known anatomical synonym", () => {
    expect(resolveVerifiedAnswer("vena cava superior", CVS_KEY).confidence).toBe("STRONG");
  });

  it("does NOT auto-verify an ambiguous partial overlap", () => {
    const r = resolveVerifiedAnswer("atrium", CVS_KEY);
    expect(r.confidence).toBe("AMBIGUOUS");
    expect(r.answer).toBeNull();
    expect(isAutoVerifiable(r.confidence)).toBe(false);
  });

  it("NONE when nothing matches", () => {
    const r = resolveVerifiedAnswer("Chorda tendinea", CVS_KEY);
    expect(r.confidence).toBe("NONE");
    expect(r.answer).toBeNull();
  });

  it("refuses to verify when the key stores prompts instead of answers", () => {
    const r = resolveVerifiedAnswer("The head.", RESP_KEY, { requireKey: true });
    expect(r.confidence).toBe("NONE");
    expect(r.answer).toBeNull();
    expect(r.reason).toMatch(/no diagnosis values/);
  });

  it("still surfaces the printed answer when the key is empty, but unverified", () => {
    const r = resolveVerifiedAnswer("The head.", RESP_KEY);
    expect(r.answer).toBe("The head.");
    expect(r.confidence).toBe("NONE");
    expect(r.verifiedBy).toEqual(["PDF_PRINTED_ANSWER"]);
  });

  it("NONE when the PDF prints no answer", () => {
    expect(resolveVerifiedAnswer(null, CVS_KEY).confidence).toBe("NONE");
  });

  it("only EXACT and STRONG are auto-verifiable", () => {
    const all: MatchConfidence[] = ["EXACT", "STRONG", "AMBIGUOUS", "NONE"];
    expect(all.filter(isAutoVerifiable)).toEqual(["EXACT", "STRONG"]);
  });
});

describe("distractor pool", () => {
  it("only offers real key answers, never invented terms", () => {
    const pool = verifiedDistractorPool(CVS_KEY, "Left atrium");
    expect(pool).toEqual(["Circumflex artery", "Superior vena cava", "Ascending aorta"]);
    expect(pool).not.toContain("Left atrium");
  });

  it("is empty when the key has no answers", () => {
    expect(verifiedDistractorPool(RESP_KEY, "anything")).toEqual([]);
  });
});
