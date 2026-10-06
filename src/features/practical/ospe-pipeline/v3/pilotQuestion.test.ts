import { describe, expect, it } from "vitest";
import {
  buildSourceMcqOptions, buildDerivedOptions, toStudentPayload, STUDENT_SAFE_KEYS,
  type PracticalQuestion, type Option,
} from "./pilotQuestion";

const opt = (label: string, text: string): Option => ({ id: `opt-${label}`, label, text, isCorrect: false, provenance: "SOURCE_PDF" });

const question = (over: Partial<PracticalQuestion> = {}): PracticalQuestion => ({
  id: "q1",
  sourceType: "DERIVED_FROM_VERIFIED_SOURCE",
  origin: "SHORT_ANSWER_DERIVED",
  subject: "CVS Anatomy",
  questionType: "IMAGE_IDENTIFICATION",
  stem: "Identify this artery:",
  images: [{ cropPath: "tmp/a.png", sourceMarkerPreserved: true, panelCount: 1 }],
  options: buildDerivedOptions("Right coronary artery", ["Left coronary artery", "Circumflex artery", "Great cardiac vein", "Coronary sinus"]).options,
  correctAnswerText: "Right coronary artery",
  answerVerified: true,
  answerProvenance: "PDF_PRINTED_ANSWER",
  sourceOptionCount: 0,
  studentOptionCount: 5,
  targetCoordinatesRequired: false,
  sourceMarkerPresent: true,
  cropSafe: true,
  nextQuestionContamination: false,
  reviewStatus: "AUTO_VERIFIED",
  warnings: [],
  provenance: { sourcePdf: "OSPE CVS.pdf", sourcePage: 2, sourceQuestionNumber: 1, questionBlockBBox: [0, 0, 595, 400], answerRegion: null, visualRegions: [] },
  ...over,
});

describe("source option count is preserved", () => {
  it("keeps a source 4-option MCQ at exactly 4", () => {
    const src = [opt("A", "The head."), opt("B", "The neck."), opt("C", "Articular facet of the tubercle."), opt("D", "The costal groove.")];
    const o = buildSourceMcqOptions(src.map((s) => ({ label: s.label, text: s.text })), "The neck.");
    expect(o).toHaveLength(4);
    // a university 4-option question must never grow a fifth choice
    expect(o.map((x) => x.label)).toEqual(["A", "B", "C", "D"]);
    expect(o.filter((x) => x.isCorrect)).toHaveLength(1);
  });

  it("keeps a source 5-option MCQ at exactly 5", () => {
    const src = ["The head.", "Crest of the head.", "The neck.", "Articular facet of the tubercle.", "Anterior end."];
    const o = buildSourceMcqOptions(src.map((t, i) => ({ label: String.fromCharCode(65 + i), text: t })), "The neck.");
    expect(o).toHaveLength(5);
    expect(o.filter((x) => x.isCorrect)).toHaveLength(1);
  });

  it("marks no option correct when the source answer is unknown", () => {
    const o = buildSourceMcqOptions([{ label: "A", text: "x" }, { label: "B", text: "y" }], null);
    expect(o.every((x) => !x.isCorrect)).toBe(true);
  });
});

describe("short-answer derived practice", () => {
  it("builds exactly 5 choices from verified facts", () => {
    const r = buildDerivedOptions("Right coronary artery", ["Left coronary artery", "Circumflex artery", "Great cardiac vein", "Coronary sinus"]);
    expect(r.options).toHaveLength(5);
    expect(r.options[0].isCorrect).toBe(true);
    expect(r.options.slice(1).every((o) => !o.isCorrect)).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("never pads when fewer than 4 verified distractors exist", () => {
    const r = buildDerivedOptions("Right coronary artery", ["Left coronary artery"]);
    expect(r.options).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/only 1 verified/);
    expect(r.warnings.join(" ")).toMatch(/not padded/);
  });

  it("deduplicates distractors case/punctuation-insensitively", () => {
    // "a."/"A" collapse into the correct answer "A"; "b"/"B." collapse together.
    const r = buildDerivedOptions("A", ["a.", "A", "b", "B.", "c"]);
    expect(r.options).toHaveLength(3);
    expect(new Set(r.options.map((o) => o.text.toLowerCase().replace(/\.$/, ""))).size).toBe(3);
  });
});

describe("image question shape", () => {
  it("keeps a single image", () => {
    expect(question().images).toHaveLength(1);
  });

  it("keeps a multi-image source as ONE question with multiple crops", () => {
    const q = question({
      images: [
        { cropPath: "tmp/gross.png", sourceMarkerPreserved: false, panelCount: 1 },
        { cropPath: "tmp/micro.png", sourceMarkerPreserved: false, panelCount: 1 },
      ],
      questionType: "MULTI_IMAGE_MCQ",
    });
    expect(q.images).toHaveLength(2);
    expect(q.provenance.sourceQuestionNumber).toBe(1); // still one question
  });

  it("requires no coordinates for a recognition question", () => {
    expect(question({ targetCoordinatesRequired: false }).targetCoordinatesRequired).toBe(false);
  });

  it("records source marker preservation", () => {
    expect(question().images[0].sourceMarkerPreserved).toBe(true);
  });
});

describe("student payload security boundary", () => {
  const payload = toStudentPayload(question(), (p) => `file://${p}`);
  const serialised = JSON.stringify(payload);

  it("includes stem, images and option text", () => {
    expect(payload.stem).toBe("Identify this artery:");
    expect(payload.images).toHaveLength(1);
    expect(payload.options).toHaveLength(5);
    expect(payload.options[0].text).toBe("Right coronary artery");
  });

  it("excludes the correct answer and every admin-only field", () => {
    for (const leaked of ["correctAnswerText", "correctOptionId", "answerKey", "answerProvenance", "reviewStatus", "warnings", "isCorrect", "provenance", "sourceMarkerPresent"]) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it("exposes only the allow-listed keys", () => {
    expect(Object.keys(payload).sort()).toEqual([...STUDENT_SAFE_KEYS].sort());
  });

  it("never leaks the correct answer text as metadata", () => {
    // the answer may appear as an option the student must choose, but never as a
    // marked/flagged field
    expect(payload.options.every((o) => !("isCorrect" in o))).toBe(true);
    expect(payload).not.toHaveProperty("correctOptionId");
  });
});

describe("OCR candidates and provenance", () => {
  it("keeps an image-only OCR candidate at NEEDS_REVIEW", () => {
    const q = question({ origin: "IMAGE_ONLY_OCR_CANDIDATE", reviewStatus: "NEEDS_REVIEW", answerVerified: false, answerProvenance: "UNVERIFIED", correctAnswerText: null, options: [] });
    expect(q.reviewStatus).toBe("NEEDS_REVIEW");
    expect(q.answerVerified).toBe(false);
  });

  it("retains full PDF provenance", () => {
    const p = question().provenance;
    expect(p.sourcePdf).toBe("OSPE CVS.pdf");
    expect(p.sourcePage).toBe(2);
    expect(p.sourceQuestionNumber).toBe(1);
    expect(p.questionBlockBBox).toHaveLength(4);
  });
});
