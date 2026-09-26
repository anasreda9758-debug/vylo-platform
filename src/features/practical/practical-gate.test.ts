import { describe, expect, it } from "vitest";
import { eligibleQuestion, gradeChoice, studentQuestion } from "./model";
import type { PracticalImage, PracticalQuestion, Scope } from "./model";

describe("student payload security (Phase 11)", () => {
  const scope: Scope = { trackId: "track-1", moduleId: "module-1", studyYear: 4, fixtures: false };

  const image = (overrides: Partial<PracticalImage> = {}): PracticalImage => ({
    id: "img-clean-9",
    trackId: "track-1",
    moduleId: "module-1",
    subject: "HISTOLOGY",
    studyYear: 4,
    storageKey: "anatomy/lung-clean.png",
    alt: "Histology slide of the lung",
    sourceMaterial: {
      title: "Lung histology slide",
      path: "exam-derivative:img-clean-9",
      sha256: "",
      approvedBy: null,
      approvedAt: null,
    },
    sourcePage: 12,
    markers: [],
    status: "APPROVED",
    isFixture: false,
    sourceImageId: "img-src-1",
    examImageId: null,
    isExamDerivative: true,
    reviewStatus: "APPROVED",
    ...overrides,
  });

  const question = (overrides: Partial<PracticalQuestion> = {}): PracticalQuestion => ({
    id: "q-1",
    academicYearId: null,
    studyYear: 4,
    trackId: "track-1",
    moduleId: "module-1",
    subject: "HISTOLOGY",
    sourceLectureId: null,
    sourceMaterial: {
      title: "AI-assisted authoring",
      path: "anatomy/lung-label.png",
      sha256: "",
      approvedBy: null,
      approvedAt: null,
    },
    sourcePage: 12,
    questionType: "IMAGE_IDENTIFICATION",
    answerFormat: "SINGLE_CHOICE",
    imageId: "img-clean-9",
    markerIds: [],
    groupId: "spotter_generated",
    order: 0,
    prompt: "Identify the structure indicated by the arrow.",
    options: [
      { id: "opt_0", text: "Primary bronchus" },
      { id: "opt_1", text: "Bronchiole" },
      { id: "opt_2", text: "Pulmonary vein" },
      { id: "opt_3", text: "Alveolar macrophage" },
      { id: "opt_4", text: "Respiratory bronchiole" },
    ],
    correctOptionId: "opt_0",
    explanation: "C-shaped cartilage identifies the bronchus.",
    identifyingClue: "C-shaped cartilage",
    commonMistake: "Confusing bronchus with bronchiole",
    examTip: "Look for cartilage",
    status: "APPROVED",
    isFixture: false,
    correctStructure: "Primary bronchus",
    reviewStatus: "APPROVED",
    sourceImageId: "img-src-1",
    examImageId: "img-clean-9",
  });

  it("NEVER leaks the correct option, answer text, teaching keys, or authoring data before submit", () => {
    const payload = studentQuestion(question()) as unknown as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(payload.correctOptionId).toBeUndefined();
    expect(payload.explanation).toBeUndefined();
    expect(payload.identifyingClue).toBeUndefined();
    expect(payload.commonMistake).toBeUndefined();
    expect(payload.examTip).toBeUndefined();
    expect(payload.sourceMaterial).toBeUndefined();
    expect(payload.sourcePage).toBeUndefined();
    expect(payload.correctStructure).toBeUndefined();
    expect(payload.reviewStatus).toBeUndefined();
    expect(payload.sourceImageId).toBeUndefined();
    expect(payload.examImageId).toBeUndefined();
    // not even smuggled inside another field
    expect(serialized).not.toContain('"correctOptionId"');
    expect(serialized).not.toContain("C-shaped cartilage");
    expect(serialized).not.toContain("look_for_cartilage_hint");
    expect(payload.imageId).toBe("img-clean-9"); // the CLEAN image, never the source id
  });

  it("correctness is answered server-side AFTER submission; the leak is only the chosen option", () => {
    const feedback = gradeChoice(question(), "opt_1");
    expect(feedback.correct).toBe(false);
    expect(feedback.correctOptionId).toBe("opt_0");
    expect(feedback.correctAnswer).toBe("Primary bronchus");
    expect(feedback.identifyingClue).toBe("C-shaped cartilage");
    expect(gradeChoice(question(), "opt_0").correct).toBe(true);
  });

  it("throws when the submitted option does not belong to the question", () => {
    expect(() => gradeChoice(question(), "opt_99")).toThrow(/does not belong/);
  });
});

describe("Eligibility public gate (0023-style, fail-closed)", () => {
  const scope: Scope = { trackId: "track-1", moduleId: "module-1", studyYear: 4, fixtures: false };
  const baseQuestion = {
    id: "q-1",
    academicYearId: null,
    studyYear: 4,
    trackId: "track-1",
    moduleId: "module-1",
    subject: "HISTOLOGY",
    sourceLectureId: null,
    sourceMaterial: {
      title: "AI-assisted authoring",
      path: "anatomy/lung-label.png",
      sha256: "",
      approvedBy: null,
      approvedAt: null,
    },
    sourcePage: 12,
    questionType: "IMAGE_IDENTIFICATION" as const,
    answerFormat: "SINGLE_CHOICE" as const,
    imageId: "img-clean-9",
    markerIds: [] as string[],
    groupId: "spotter_generated",
    order: 0,
    prompt: "Identify the structure indicated by the arrow.",
    options: [
      { id: "opt_0", text: "Primary bronchus" },
      { id: "opt_1", text: "Bronchiole" },
      { id: "opt_2", text: "Pulmonary vein" },
      { id: "opt_3", text: "Alveolar macrophage" },
      { id: "opt_4", text: "Respiratory bronchiole" },
    ],
    correctOptionId: "opt_0",
    explanation: "C-shaped cartilage identifies the bronchus.",
    identifyingClue: "C-shaped cartilage",
    commonMistake: "Confusing bronchus with bronchiole",
    examTip: "Look for cartilage",
    status: "APPROVED" as const,
    isFixture: false,
    correctStructure: "Primary bronchus",
    reviewStatus: "APPROVED" as const,
    sourceImageId: "img-src-1",
    examImageId: "img-clean-9",
  };
  const derivative = (overrides: Partial<PracticalImage> = {}): PracticalImage => ({
    id: "img-clean-9",
    trackId: "track-1",
    moduleId: "module-1",
    subject: "HISTOLOGY",
    studyYear: 4,
    storageKey: "anatomy/lung-clean.png",
    alt: "Histology slide of the lung",
    sourceMaterial: {
      title: "Lung histology slide",
      path: "exam-derivative:img-clean-9",
      sha256: "",
      approvedBy: null,
      approvedAt: null,
    },
    sourcePage: 12,
    markers: [],
    status: "APPROVED",
    isFixture: false,
    sourceImageId: "img-src-1",
    examImageId: null,
    isExamDerivative: true,
    reviewStatus: "APPROVED",
    ...overrides,
  });

  it("authoring-approved artifacts are eligible (admin verified answer + clean derivative + real file)", () => {
    expect(eligibleQuestion(baseQuestion as PracticalQuestion, derivative(), scope)).toBe(true);
  });

  it("blocks DRAFT / NEEDS_REVIEW / REJECTED even when status says APPROVED", () => {
    for (const review of ["DRAFT", "NEEDS_REVIEW", "REJECTED", undefined] as const) {
      expect(
        eligibleQuestion({ ...baseQuestion, reviewStatus: review } as PracticalQuestion, derivative(), scope),
      ).toBe(false);
    }
  });

  it("blocks when the student-facing image is the LABELED SOURCE, not a clean derivative", () => {
    const labeled = derivative({ isExamDerivative: false, id: "img-src-1", examImageId: null });
    expect(eligibleQuestion(baseQuestion as PracticalQuestion, labeled, scope)).toBe(false);
  });

  it("blocks when the clean image is not itself admin-approved or has no uploaded file", () => {
    expect(
      eligibleQuestion(baseQuestion as PracticalQuestion, derivative({ reviewStatus: "DRAFT" }), scope),
    ).toBe(false);
    expect(eligibleQuestion(baseQuestion as PracticalQuestion, derivative({ storageKey: "" }), scope)).toBe(false);
  });

  it("blocks when the artifact or image is not APPROVED in the classic sense", () => {
    expect(
      eligibleQuestion({ ...baseQuestion, status: "DRAFT_AI" } as PracticalQuestion, derivative(), scope),
    ).toBe(false);
    expect(
      eligibleQuestion(baseQuestion as PracticalQuestion, derivative({ status: "DRAFT_AI" }), scope),
    ).toBe(false);
  });

  it("legacy approved-source rows still pass WITHOUT authoring metadata (old behavior unchanged)", () => {
    const legacyQ: unknown = {
      ...baseQuestion,
      sourceMaterial: {
        title: "Legacy lung slide",
        path: "anatomy/lung-label.png",
        sha256: "a".repeat(64),
        approvedBy: "admin-1",
        approvedAt: "2026-01-01T00:00:00Z",
      },
      reviewStatus: undefined,
      correctStructure: undefined,
      sourceImageId: undefined,
      examImageId: undefined,
    };
    const legacyImg: PracticalImage = derivative({
      sourceImageId: undefined,
      examImageId: null,
      isExamDerivative: undefined,
      reviewStatus: undefined,
      alt: "Legacy lung slide",
      sourceMaterial: {
        title: "Legacy lung slide",
        path: "anatomy/lung-label.png",
        sha256: "b".repeat(64),
        approvedBy: "admin-1",
        approvedAt: "2026-01-01T00:00:00Z",
      },
    });
    expect(eligibleQuestion(legacyQ as PracticalQuestion, legacyImg, scope)).toBe(true);
  });

  it("still blocks unrelated module/track/year mismatches", () => {
    expect(
      eligibleQuestion(baseQuestion as PracticalQuestion, derivative({ moduleId: "module-2" }), scope),
    ).toBe(false);
    expect(
      eligibleQuestion({ ...baseQuestion, studyYear: 5 } as PracticalQuestion, derivative(), scope),
    ).toBe(false);
  });
});