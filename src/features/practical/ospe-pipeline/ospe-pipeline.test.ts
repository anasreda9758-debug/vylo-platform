import { describe, expect, it } from "vitest";
import { questionSchema, imageSchema, markerSchema } from "../model";
import {
  questionTypeSchema, reviewStatusSchema, sourceSchema,
  eligibleQuestion, studentQuestion,
} from "../model";
import { classifyPage } from "./classify";
import { isAutoVerifiedSource, canAdminApprove, approveQuestion, isAnswerLeak } from "./review";
import { renderDryRunMarkdown } from "./dry-run";
import type { PracticalQuestion, PracticalImage } from "../model";

const makeQ = (over: Partial<PracticalQuestion> = {}): PracticalQuestion => ({
  id: "q1", academicYearId: null, studyYear: 1, trackId: "t1", moduleId: "m1", subject: "ANATOMY",
  sourceLectureId: null,
  sourceMaterial: { title: "T", path: "p", sha256: "", approvedBy: null, approvedAt: null, pdf: "OSPE RENAL.pdf", questionNumber: 2 },
  sourcePage: 2, questionType: "IMAGE_IDENTIFY_STRUCTURE", answerFormat: "SINGLE_CHOICE",
  imageId: "img1", markerIds: [], groupId: "g1", order: 0,
  prompt: "Identify structure number 2.",
  options: [{ id: "opt0", text: "Psoas major" }, { id: "opt1", text: "Ql" }, { id: "opt2", text: "R" }, { id: "opt3", text: "S" }, { id: "opt4", text: "T" }],
  correctOptionId: "opt0",
  explanation: "e", identifyingClue: "c", commonMistake: "m", examTip: "t",
  status: "DRAFT_AI", isFixture: false,
  correctStructure: null, reviewStatus: "AUTO_VERIFIED_SOURCE",
  sourceImageId: null, examImageId: null,
  targetX: null, targetY: null,
});

const makeImage = (): PracticalImage => ({
  id: "img1", trackId: "t1", moduleId: "m1", studyYear: 1, subject: "ANATOMY",
  storageKey: "k", alt: "a", sourceMaterial: { title: "T", path: "p", sha256: "", approvedBy: null, approvedAt: null },
  sourcePage: 2, markers: [], status: "APPROVED", isFixture: false,
  sourceImageId: null, examImageId: null, isExamDerivative: false,
  reviewStatus: "APPROVED",
});

describe("classifyPage", () => {
  it("detects IMAGE_IDENTIFY_STRUCTURE from 'N ? Label' text", () => {
    const text = "Diaphragm\n2\n?\nPsoas major\n3\n?";
    const { questions } = classifyPage(text, "test.pdf", 1);
    expect(questions.filter((q) => q.kind === "IMAGE_IDENTIFY_STRUCTURE").length).toBeGreaterThanOrEqual(1);
    const q = questions.find((q) => q.kind === "IMAGE_IDENTIFY_STRUCTURE");
    expect(q?.answer).toBe("Psoas major");
    expect(q?.options.length).toBeGreaterThanOrEqual(1);
  });

  it("detects IMAGE_RELATED_STRUCTURE from 'related to this area' prompts", () => {
    const text = "Identify the structure related to this area: Left suprarenal gland Identify the structure related to this area: Stomach Identify the structure related to this area: Spleen";
    const { questions } = classifyPage(text, "test.pdf", 2);
    const q = questions.find((q) => q.kind === "IMAGE_RELATED_STRUCTURE");
    expect(q).toBeDefined();
    expect(q?.options.length).toBe(3);
    expect(q?.answer).toBe("Left suprarenal gland");
  });

  it("detects TEXT_OR_IMAGE_MCQ from A/B/C/D/E options", () => {
    const text = "Which structure is shown? A. Psoas major B. Quadratus lumborum C. Diaphragm D. Transversus E. Iliacus";
    const { questions } = classifyPage(text, "test.pdf", 3);
    const q = questions.find((q) => q.kind === "TEXT_OR_IMAGE_MCQ");
    expect(q).toBeDefined();
    expect(q?.options.length).toBe(5);
  });

  it("detects IMAGE_IDENTIFY_STRUCTURE from 'Identify the labeled structure:' phrasing", () => {
    const text = "Identify the labeled structure: Thymus gland Identify the labeled structure: Lymph node";
    const { questions } = classifyPage(text, "test.pdf", 5);
    const q = questions.find((q) => q.kind === "IMAGE_IDENTIFY_STRUCTURE");
    expect(q).toBeDefined();
    expect(q?.options.length).toBeGreaterThanOrEqual(1);
  });

  it("detects IMAGE_LAB_IDENTIFICATION from 'Identify the organism'", () => {
    const text = "Identify the organism: Gram-positive cocci in clusters";
    const { questions } = classifyPage(text, "test.pdf", 6);
    const q = questions.find((q) => q.kind === "IMAGE_LAB_IDENTIFICATION");
    expect(q).toBeDefined();
  });

  it("returns unparseable for page with no readable text", () => {
    const { questions, unparseablePages } = classifyPage("   ", "test.pdf", 4);
    expect(questions.length).toBe(0);
    expect(unparseablePages).toContain(4);
  });
});

describe("schemas", () => {
  it("questionTypeSchema contains all 8 new pipeline kinds plus legacy types", () => {
    const kinds = questionTypeSchema.options;
    expect(kinds).toContain("IMAGE_IDENTIFY_STRUCTURE");
    expect(kinds).toContain("IMAGE_IDENTIFY_PART");
    expect(kinds).toContain("IMAGE_RELATED_STRUCTURE");
    expect(kinds).toContain("IMAGE_DIAGNOSIS");
    expect(kinds).toContain("IMAGE_LAB_IDENTIFICATION");
    expect(kinds).toContain("IMAGE_SURFACE_ANATOMY");
    expect(kinds).toContain("TEXT_OR_IMAGE_MCQ");
    expect(kinds).toContain("IMAGE_MARKED_REGION");
    expect(kinds).toContain("IMAGE_IDENTIFICATION");
  });

  it("reviewStatusSchema contains AUTO_VERIFIED_SOURCE", () => {
    expect(reviewStatusSchema.options).toContain("AUTO_VERIFIED_SOURCE");
  });

  it("sourceSchema accepts pdf and questionNumber", () => {
    const ok = sourceSchema.safeParse({ title: "T", path: "p", sha256: "", approvedBy: null, approvedAt: null, pdf: "OSPE RENAL.pdf", questionNumber: 2 });
    expect(ok.success).toBe(true);
  });

  it("questionSchema validates a bilingual prompt and options", () => {
    const q = questionSchema.safeParse({
      id: "q1", academicYearId: null, studyYear: 1, trackId: "t1", moduleId: "m1", subject: "ANATOMY",
      sourceLectureId: null, sourceMaterial: { title: "T", path: "p", sha256: "", approvedBy: null, approvedAt: null, pdf: "f.pdf", questionNumber: 1 },
      sourcePage: 1, questionType: "IMAGE_IDENTIFY_STRUCTURE", answerFormat: "SINGLE_CHOICE",
      imageId: "img1", markerIds: [], groupId: "g1", order: 0,
      prompt: "حدد البنية رقم 2.",
      options: [{ id: "o1", text: "Psoas major" }, { id: "o2", text: "Ql" }, { id: "o3", text: "R" }, { id: "o4", text: "S" }, { id: "o5", text: "T" }],
      correctOptionId: "o1", explanation: "e", identifyingClue: "c", commonMistake: "m", examTip: "t",
      status: "DRAFT_AI", isFixture: false, correctStructure: null, reviewStatus: "AUTO_VERIFIED_SOURCE",
      sourceImageId: null, examImageId: null, targetX: null, targetY: null,
    });
    expect(q.success).toBe(true);
  });

  it("questionSchema rejects options without a valid correctOptionId", () => {
    const q = questionSchema.safeParse({
      id: "q1", academicYearId: null, studyYear: 1, trackId: "t1", moduleId: "m1", subject: "ANATOMY",
      sourceLectureId: null, sourceMaterial: { title: "T", path: "p", sha256: "", approvedBy: null, approvedAt: null },
      sourcePage: 1, questionType: "IMAGE_IDENTIFY_STRUCTURE", answerFormat: "SINGLE_CHOICE",
      imageId: "img1", markerIds: [], groupId: "g1", order: 0,
      prompt: "x", options: [{ id: "o1", text: "A" }, { id: "o2", text: "B" }],
      correctOptionId: "o3", explanation: "e", identifyingClue: "c", commonMistake: "m", examTip: "t",
      status: "DRAFT_AI", isFixture: false,
    });
    expect(q.success).toBe(false);
  });
});

describe("studentQuestion answer-security", () => {
  it("studentQuestion does not leak source traceability; full question carries it for admin", () => {
    const q = makeQ();
    const s = studentQuestion(q);
    expect("sourceMaterial" in s).toBe(false);
    expect(q.sourceMaterial).toEqual({ title: "T", path: "p", sha256: "", approvedBy: null, approvedAt: null, pdf: "OSPE RENAL.pdf", questionNumber: 2 });
    expect(q.sourcePage).toBe(2);
  });

  it("does not leak correctOptionId or explanation", () => {
    const q = makeQ();
    const s = studentQuestion(q);
    expect("correctOptionId" in s).toBe(false);
    expect("explanation" in s).toBe(false);
  });

  it("includes options, prompt, markerIds, questionType", () => {
    const q = makeQ();
    const s = studentQuestion(q);
    expect(s.options.length).toBe(5);
    expect(s.prompt).toBe("Identify structure number 2.");
    expect(s.questionType).toBe("IMAGE_IDENTIFY_STRUCTURE");
    expect(s.markerIds).toEqual([]);
  });
});

describe("review gates", () => {
  it("isAutoVerifiedSource true for AUTO_VERIFIED_SOURCE", () => {
    expect(isAutoVerifiedSource({ ...makeQ(), reviewStatus: "AUTO_VERIFIED_SOURCE" })).toBe(true);
    expect(isAutoVerifiedSource({ ...makeQ(), reviewStatus: "NEEDS_REVIEW" })).toBe(false);
  });

  it("canAdminApprove true for AUTO_VERIFIED_SOURCE and NEEDS_REVIEW", () => {
    expect(canAdminApprove({ ...makeQ(), reviewStatus: "AUTO_VERIFIED_SOURCE" })).toBe(true);
    expect(canAdminApprove({ ...makeQ(), reviewStatus: "NEEDS_REVIEW" })).toBe(true);
    expect(canAdminApprove({ ...makeQ(), reviewStatus: "APPROVED" })).toBe(false);
  });

  it("approveQuestion transitions to APPROVED", () => {
    const q = approveQuestion({ ...makeQ(), reviewStatus: "AUTO_VERIFIED_SOURCE" });
    expect(q.reviewStatus).toBe("APPROVED");
    expect(q.status).toBe("APPROVED");
  });

  it("approveQuestion throws for DRAFT", () => {
    expect(() => approveQuestion({ ...makeQ(), reviewStatus: "DRAFT" })).toThrow();
  });

  it("eligibleQuestion keeps AUTO_VERIFIED_SOURCE hidden from students", () => {
    expect(eligibleQuestion(makeQ(), makeImage(), { trackId: "t1", moduleId: "m1", studyYear: 1, fixtures: false })).toBe(false);
  });

  it("eligibleQuestion allows APPROVED question with valid credentials", () => {
    const q = makeQ();
    const approved = { ...q, status: "APPROVED" as const, reviewStatus: "APPROVED" as const, sourceMaterial: { ...q.sourceMaterial, sha256: "a".repeat(64), approvedBy: "admin", approvedAt: "2026-01-01" } };
    const img: PracticalImage = { ...makeImage(), isExamDerivative: true, reviewStatus: "APPROVED", storageKey: "k" };
    expect(eligibleQuestion(approved, img, { trackId: "t1", moduleId: "m1", studyYear: 1, fixtures: false })).toBe(true);
  });
});

describe("answer leak", () => {
  it("detects correctOptionId as a leak", () => {
    expect(isAnswerLeak({ correctOptionId: "o1" })).toBe(true);
  });

  it("does not flag a student payload", () => {
    expect(isAnswerLeak({ id: "q1", prompt: "x", options: [] })).toBe(false);
  });
});

describe("dry-run report", () => {
  it("renders markdown with summary", () => {
    const report = {
      schemaVersion: 1, mode: "READ_ONLY_DRY_RUN" as const, generatedAt: "2026-01-01T00:00:00.000Z",
      sourcePdf: "OSPE RENAL.pdf",
      summary: { total: 2, confident: 1, needsReview: 1, byKind: { IMAGE_IDENTIFY_STRUCTURE: 1, IMAGE_RELATED_STRUCTURE: 1 } },
      rows: [{ index: 0, kind: "IMAGE_IDENTIFY_STRUCTURE" as const, status: "CONFIDENT" as const, traceability: { sourcePdf: "OSPE RENAL.pdf", sourcePage: 2, sourceQuestionNumber: 2 }, prompt: "x", optionCount: 1, answerFound: true, imageExists: true, reasons: [] }],
      rejected: [],
    };
    const md = renderDryRunMarkdown(report as any);
    expect(md).toContain("TOTAL QUESTIONS DISCOVERED:");
    expect(md).toContain("CONFIDENT");
  });
});

describe("traceability preserved", () => {
  it("classifyQuestion preserves sourcePdf/sourcePage/sourceQuestionNumber", () => {
    const { questions } = classifyPage("2\n?\nPsoas major", "OSPE RENAL.pdf", 2);
    const q = questions[0];
    expect(q.traceability.sourcePdf).toBe("OSPE RENAL.pdf");
    expect(q.traceability.sourcePage).toBe(2);
    expect(q.traceability.sourceQuestionNumber).toBeNull();
  });
});

describe("marker schema", () => {
  it("validates a marker with optional label", () => {
    expect(markerSchema.safeParse({ id: "m1", x: 0.5, y: 0.5, label: "A1" }).success).toBe(true);
    expect(markerSchema.safeParse({ id: "m1", x: 0, y: 0 }).success).toBe(true);
  });
});
