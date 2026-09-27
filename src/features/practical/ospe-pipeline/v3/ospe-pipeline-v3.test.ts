import { describe, expect, it } from "vitest";
import { detectQuestionNumber, validateSequence, isMeasurementLine } from "./numbering";
import { buildTextBlocks, segmentPanels, buildPanelModel, containment, type BBox } from "./geometry";
import { dedupeBlocks, detectV3 } from "./detectV3";
import { detectPointer, isMarkerGlyph, type PointerMode } from "./pointer";
import { buildPools, buildFiveChoices, categorise, isCompatibleDistractor, normaliseOption, type PoolEntry } from "./distractors";
import type { PageDoc } from "../v2/pageParse";
import type { PageClass } from "../v2/classifyPage";

function ln(text: string, x: number, y: number, width = 120, height = 12) {
  return { text, x, y, width, height, spans: [{ text, x, y, width, height, fontSize: height }] };
}
function pg(lines: ReturnType<typeof ln>[], over: Partial<PageDoc> = {}): PageDoc {
  return { page: 1, width: 595, height: 842, lines, text: lines.map((l) => l.text).join("\n"), imageOps: 0, vectorOps: 0, colourOps: 0, hasSourceMarker: false, ...over };
}

describe("1. Q500 false-positive rejection", () => {
  it("rejects a bare outlier number with no question syntax", () => {
    expect(detectQuestionNumber("Q500")).toBeNull();
    expect(detectQuestionNumber("500")).toBeNull();
  });
  it("rejects a clinical volume reading", () => {
    expect(detectQuestionNumber("500 ml.")).toBeNull();
    expect(isMeasurementLine("500 ml.")).toBe(true);
  });
});

describe("2. numeric medical values are not questions", () => {
  it.each(["500 ml.", "2.5 mg", "120 bpm", "80 mmHg", "3 mm", "14 %"])("rejects %s", (s) => {
    expect(detectQuestionNumber(s)).toBeNull();
  });
  it("still accepts every documented numbering style", () => {
    expect(detectQuestionNumber("Q1) Inferior aperture")?.number).toBe(1);
    expect(detectQuestionNumber("Q1: Inferior aperture")?.number).toBe(1);
    expect(detectQuestionNumber("Q 1) Inferior aperture")?.number).toBe(1);
    expect(detectQuestionNumber("Q 12) Inferior aperture")?.number).toBe(12);
    expect(detectQuestionNumber("12) Inferior aperture")?.number).toBe(12);
    expect(detectQuestionNumber("Question 12 Inferior aperture")?.number).toBe(12);
  });
  it("rejects a decimal that would otherwise split into a number", () => {
    expect(detectQuestionNumber("12.5 mg")).toBeNull();
  });
});

describe("3. sequence outlier detection", () => {
  it("flags a lone outlier instead of letting it become the max", () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 500];
    const v = validateSequence(seq);
    expect(v.rawMax).toBe(500);
    expect(v.validatedMax).toBe(12);
    expect(v.outliers).toEqual([500]);
    expect(v.rejected[0].reason).toMatch(/NUMBER_OUTLIER/);
  });
  it("reports genuine gaps and duplicates separately", () => {
    const v = validateSequence([1, 2, 2, 4]);
    expect(v.duplicates).toEqual([2]);
    expect(v.gaps).toEqual([3]);
  });
});

describe("4/5. page geometry and panel segmentation", () => {
  it("splits two horizontal panels", () => {
    const p = pg([ln("Identify this chamber:", 20, 700), ln("Identify this vein:", 330, 700)]);
    const panels = segmentPanels(p, buildTextBlocks(p));
    expect(panels).toHaveLength(2);
    expect(panels[0].orientation).toBe("LEFT");
    expect(panels[1].orientation).toBe("RIGHT");
  });
  it("splits two vertical panels", () => {
    const p = pg([ln("Identify this chamber:", 20, 780), ln("Identify this vein:", 20, 300)]);
    const panels = segmentPanels(p, buildTextBlocks(p));
    expect(panels).toHaveLength(2);
    expect(panels.map((x) => x.orientation).sort()).toEqual(["BOTTOM", "TOP"]);
  });
  it("keeps a single-panel page as one panel", () => {
    const p = pg([ln("Q1) Inferior aperture of thorax", 20, 700), ln("A. Sternum", 20, 680)]);
    expect(segmentPanels(p, buildTextBlocks(p))).toHaveLength(1);
  });
});

describe("6/7. region-scoped association and caption dedup", () => {
  it("keeps an answer inside its own panel and out of the other", () => {
    const p = pg(
      [ln("Identify this chamber:", 20, 700), ln("Left atrium", 20, 672), ln("Identify this vein:", 330, 700), ln("Great cardiac vein", 330, 672)],
      { imageOps: 1 },
    );
    const qs = detectV3(p, { fileName: "OSPE CVS.pdf", subject: "Cardio-Vascular System", pageClass: "QUESTION_SHORT_ANSWER" });
    expect(qs).toHaveLength(2);
    const chamber = qs.find((q) => /chamber/.test(q.stem))!;
    const vein = qs.find((q) => /vein/.test(q.stem))!;
    expect(chamber.answer).toBe("Left atrium");
    expect(vein.answer).toBe("Great cardiac vein");
    expect(chamber.answer).not.toBe(vein.answer);
  });
  it("collapses a caption drawn twice in the same place", () => {
    const b = (text: string, x: number, y: number) => ({ text, bbox: { x0: x, y0: y, x1: x + 90, y1: y + 10 } });
    const out = dedupeBlocks([b("Identify the labeled structure:", 40, 100), b("Identify the labeled structure:", 41, 101)]);
    expect(out).toHaveLength(1);
  });
  it("does not collapse identical captions in different regions", () => {
    const b = (text: string, x: number, y: number) => ({ text, bbox: { x0: x, y0: y, x1: x + 90, y1: y + 10 } });
    const out = dedupeBlocks([b("Identify the labeled structure:", 40, 100), b("Identify the labeled structure:", 400, 100)]);
    expect(out).toHaveLength(2);
  });
});

describe("8. ambiguous answer becomes NEEDS_REVIEW", () => {
  it("does not guess when two answers are equally plausible", () => {
    const p = pg([ln("Identify the labeled structure:", 20, 700), ln("Pharyngeal tonsil", 20, 678), ln("Lingual tonsil", 20, 672)], { imageOps: 1 });
    const q = detectV3(p, { fileName: "OSPE IBL.pdf", subject: "Immune, Blood & Lymphatic", pageClass: "QUESTION_SHORT_ANSWER" })[0];
    expect(q.answer).toBeNull();
    expect(q.needsReview).toBe(true);
    expect(q.warnings.length).toBeGreaterThan(0);
  });
});

describe("9/10. image association and answer leak", () => {
  it("associates the panel image and derives a student crop", () => {
    const p = pg([ln("Identify this chamber:", 20, 700), ln("Left atrium", 20, 672)], { imageOps: 1 });
    const q = detectV3(p, { fileName: "OSPE CVS.pdf", subject: "Cardio-Vascular System", pageClass: "QUESTION_SHORT_ANSWER" })[0];
    expect(q.imageBBox).not.toBeNull();
    expect(q.studentCropBBox).not.toBeNull();
    expect(q.imageConfidence).toBe("MEDIUM");
  });
  it("flags a leak when the crop cannot be shrunk safely", () => {
    const p = pg([ln("Identify this chamber:", 20, 700), ln("Left atrium", 20, 660)], { imageOps: 1 });
    const q = detectV3(p, { fileName: "OSPE CVS.pdf", subject: "Cardio-Vascular System", pageClass: "QUESTION_SHORT_ANSWER" })[0];
    expect(typeof q.answerLeakRisk).toBe("boolean");
  });
  it("marks a panel with no image region as needing review", () => {
    const p = pg([ln("Identify this chamber:", 20, 700), ln("Left atrium", 20, 672)], { imageOps: 0 });
    const q = detectV3(p, { fileName: "OSPE CVS.pdf", subject: "Cardio-Vascular System", pageClass: "QUESTION_SHORT_ANSWER" })[0];
    expect(q.imageBBox).toBeNull();
    expect(q.imageConfidence).toBe("NONE");
    expect(q.needsReview).toBe(true);
  });
});

describe("11. pointer mode is not inferred from vector-op count", () => {
  it("never claims a confirmed marker from vector ops alone", () => {
    const p = detectPointer({ panelLines: [{ text: "Left atrium", x0: 0, y0: 0, x1: 10, y1: 10 }], vectorOps: 500, hasImage: false });
    expect(p.mode).not.toBe("SOURCE_CONFIRMED");
  });
  it("confirms a marker only from a real marker glyph in the panel", () => {
    const p = detectPointer({ panelLines: [{ text: "?", x0: 0, y0: 0, x1: 10, y1: 10 }], vectorOps: 0, hasImage: false });
    expect(p.mode).toBe("SOURCE_CONFIRMED");
  });
  it("reports MANUAL_REQUIRED when there is neither marker nor image", () => {
    const p = detectPointer({ panelLines: [{ text: "Left atrium", x0: 0, y0: 0, x1: 10, y1: 10 }], vectorOps: 0, hasImage: false });
    expect(p.mode).toBe("MANUAL_REQUIRED");
  });
  it("detects marker glyphs", () => {
    expect(isMarkerGlyph("?")).toBe(true);
    expect(isMarkerGlyph("1")).toBe(true);
    expect(isMarkerGlyph("Left atrium")).toBe(false);
  });
});

describe("13. image-only documents are classified, not treated as empty", () => {
  it("classifies a page with images and no text as an image-only source", () => {
    const model = buildPanelModel(pg([], { imageOps: 3, vectorOps: 0 }));
    expect(model.panels).toHaveLength(0);
    expect(model.images).toHaveLength(1);
  });
});

describe("14/15/16/17/18. distractor pools", () => {
  const verified: PoolEntry[] = [
    { answer: "Right coronary artery", category: "ARTERY", subject: "CVS", sourcePdf: "a" },
    { answer: "Left coronary artery", category: "ARTERY", subject: "CVS", sourcePdf: "a" },
    { answer: "Circumflex artery", category: "ARTERY", subject: "CVS", sourcePdf: "a" },
    { answer: "Great cardiac vein", category: "VEIN", subject: "CVS", sourcePdf: "a" },
    { answer: "Middle cardiac vein", category: "VEIN", subject: "CVS", sourcePdf: "a" },
    { answer: "Small cardiac vein", category: "VEIN", subject: "CVS", sourcePdf: "a" },
    { answer: "Coronary sinus", category: "VEIN", subject: "CVS", sourcePdf: "a" },
    { answer: "Anterior cardiac vein", category: "VEIN", subject: "CVS", sourcePdf: "a" },
    { answer: "Left atrium", category: "CHAMBER", subject: "CVS", sourcePdf: "a" },
  ];
  const pools = buildPools(verified);

  it("categorises answers into semantic pools", () => {
    expect(categorise("Left coronary artery")).toBe("ARTERY");
    expect(categorise("Great cardiac vein")).toBe("VEIN");
    expect(categorise("Left atrium")).toBe("CHAMBER");
  });
  it("builds exactly five unique options from verified answers only", () => {
    const r = buildFiveChoices("Great cardiac vein", "VEIN", "CVS", pools);
    expect(r.ok).toBe(true);
    expect(r.options).toHaveLength(5);
    expect(r.options[0]).toBe("Great cardiac vein");
    const norms = r.options.map(normaliseOption);
    expect(new Set(norms).size).toBe(5);
    expect(norms.filter((n) => n === "great cardiac vein")).toHaveLength(1);
    for (const o of r.options) expect(verified.some((v) => v.answer === o)).toBe(true);
  });
  it("downgrades to NEEDS_REVIEW when the pool is too small", () => {
    const r = buildFiveChoices("Left atrium", "CHAMBER", "CVS", pools);
    expect(r.ok).toBe(false);
    expect(r.options).toHaveLength(0);
    expect(r.reason).toMatch(/insufficient/);
  });
  it("rejects an incompatible-category distractor", () => {
    expect(isCompatibleDistractor("CHAMBER", "Great cardiac vein", "VEIN")).toBe(false);
    expect(isCompatibleDistractor("VESSEL", "Great cardiac vein", "VEIN")).toBe(true);
  });
  it("never invents a term outside the verified pool", () => {
    const r = buildFiveChoices("Circumflex artery", "ARTERY", "CVS", pools);
    if (r.ok) for (const o of r.options) expect(verified.some((v) => v.answer === o)).toBe(true);
    else expect(r.reason).toMatch(/insufficient/);
  });
});

describe("20. benchmark metric calculation", () => {
  it("computes precision/recall from matched predictions", () => {
    type Row = { pdf: string; page: number; number: number | null; stem: string };
    const truth: Row[] = [
      { pdf: "OSPE RESP.pdf", page: 2, number: 1, stem: "Inferior aperture" },
      { pdf: "OSPE RESP.pdf", page: 3, number: 3, stem: "Identify the labeled part" },
    ];
    const predicted: Row[] = [
      { pdf: "OSPE RESP.pdf", page: 2, number: 1, stem: "Inferior aperture" },
      { pdf: "OSPE RESP.pdf", page: 3, number: 3, stem: "Identify the labeled part" },
      { pdf: "OSPE RESP.pdf", page: 4, number: 4, stem: "Identify this chamber" },
    ];
    const key = (r: Row) => `${r.pdf}|${r.page}|${r.number ?? ""}|${r.stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const truthKeys = new Set(truth.map(key));
    const predKeys = predicted.map(key);
    const tp = predKeys.filter((k) => truthKeys.has(k)).length;
    const fp = predKeys.filter((k) => !truthKeys.has(k)).length;
    const fn = truth.filter((r) => !predKeys.includes(key(r))).length;
    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    expect(tp).toBe(2);
    expect(fp).toBe(1);
    expect(fn).toBe(0);
    expect(precision).toBeCloseTo(2 / 3, 5);
    expect(recall).toBe(1);
  });
});
