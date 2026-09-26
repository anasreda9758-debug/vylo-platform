import { beforeEach, describe, expect, it } from "vitest";
import { createPracticalService, type PracticalStore, type RequestScope } from "./service";
import type { PracticalImage, PracticalQuestion, Progress, ResolvedPracticalTrack, Scope } from "./model";

const trackA: ResolvedPracticalTrack = {
  id: "track-a", moduleId: "module-1", moduleSlug: "rau-203", moduleName: "Renal & Urinary System", studyYear: 1,
  subject: "ANATOMY", subjectSlug: "anatomy", displayNameEn: "Anatomy", displayNameAr: "التشريح",
  status: "PUBLISHED", sortOrder: 0, practiceEnabled: true, ospeEnabled: false,
};
const trackB: ResolvedPracticalTrack = {
  id: "track-b", moduleId: "module-2", moduleSlug: "rs-201", moduleName: "Respiratory System", studyYear: 1,
  subject: "HISTOLOGY", subjectSlug: "histology", displayNameEn: "Histology", displayNameAr: "علم الأنسجة",
  status: "PUBLISHED", sortOrder: 0, practiceEnabled: true, ospeEnabled: false,
};

const sourceMaterial = { title: "AI-assisted authoring", path: "renal/label.png", sha256: "", approvedBy: null, approvedAt: null };
const cleanMaterial = { title: "Clean exam version", path: "exam-derivative:x", sha256: "", approvedBy: null, approvedAt: null };

function approvedImage(overrides: Partial<PracticalImage> = {}): PracticalImage {
  return {
    id: "img-renal-clean", trackId: "track-a", moduleId: "module-1", subject: "ANATOMY", studyYear: 1,
    storageKey: "renal-1-clean.png", alt: "Renal anatomy (clean)", sourceMaterial: cleanMaterial, sourcePage: 1,
    markers: [], status: "APPROVED", isFixture: false, sourceImageId: "img-renal-src", examImageId: null,
    isExamDerivative: true, reviewStatus: "APPROVED", ...overrides,
  };
}

function approvedQuestion(overrides: Partial<PracticalQuestion> = {}): PracticalQuestion {
  return {
    id: "q-renal-1", academicYearId: null, studyYear: 1, trackId: "track-a", moduleId: "module-1", subject: "ANATOMY",
    sourceLectureId: null, sourceMaterial, sourcePage: 1, questionType: "IMAGE_IDENTIFICATION", answerFormat: "SINGLE_CHOICE",
    imageId: "img-renal-clean", markerIds: [], groupId: "renal", order: 0, prompt: "Identify the structure indicated by the arrow.",
    options: [
      { id: "opt_0", text: "Kidney" },
      { id: "opt_1", text: "Renal vein" },
      { id: "opt_2", text: "Ureter" },
      { id: "opt_3", text: "Adrenal gland" },
      { id: "opt_4", text: "Renal fascia" },
    ],
    correctOptionId: "opt_0", explanation: "The renal hilum sits here.", identifyingClue: "Hilum", commonMistake: "None",
    examTip: "Look for the hilum", status: "APPROVED", isFixture: false, correctStructure: "Kidney",
    reviewStatus: "APPROVED", sourceImageId: "img-renal-src", examImageId: "img-renal-clean", ...overrides,
  };
}

/** Mirrors practicalStore.catalog's SQL scope EXACTLY (question+image tracked). */
class ScopedMemoryStore implements PracticalStore {
  questions: PracticalQuestion[] = [];
  images: PracticalImage[] = [];
  async catalog(scope: Scope) {
    const qIds = new Set(this.questions.filter((q) => q.imageId !== null).map((q) => q.imageId));
    const matchedQuestions = this.questions.filter(
      (q) => q.trackId === scope.trackId && q.moduleId === scope.moduleId && q.isFixture === scope.fixtures,
    );
    const matchedImages = this.images.filter(
      (i) => i.trackId === scope.trackId && i.moduleId === scope.moduleId && i.isFixture === scope.fixtures && qIds.has(i.id),
    );
    const rows = matchedQuestions
      .filter((q) => matchedImages.some((i) => i.id === q.imageId))
      .map((q) => ({ question: q, image: matchedImages.find((i) => i.id === q.imageId)! }));
    return { questions: rows.map((r) => r.question), images: rows.map((r) => r.image) };
  }
  async progress(_userId: string, questionIds: string[]): Promise<Progress[]> { return questionIds.map((questionId) => ({ questionId, attempts: 0, correct: 0, wrong: 0, wrongRemaining: false, bookmarked: false, difficult: false })); }
  async saveAnswer(): Promise<void> {}
  async setFlag(): Promise<void> {}
}

describe("APPROVED real question visibility chain (trackId binding)", () => {
  let store: ScopedMemoryStore;
  let service: ReturnType<typeof createPracticalService>;
  const actor = { id: "student-1" };
  const trackARequest: RequestScope = { moduleSlug: "rau-203", subjectSlug: "anatomy", fixtures: false };
  const trackBRequest: RequestScope = { moduleSlug: "rs-201", subjectSlug: "histology", fixtures: false };
  const tracks = new Map([["rau-203/anatomy", trackA], ["rs-201/histology", trackB]]);

  beforeEach(() => {
    store = new ScopedMemoryStore();
    service = createPracticalService(
      store,
      async (_actor, moduleSlug, subjectSlug) => {
        const track = tracks.get(`${moduleSlug}/${subjectSlug}`);
        return track ? { ok: true, value: track } : { ok: false, reason: "not_found" };
      },
      false,
    );
  });

  it("returns the APPROVED derivative question for its own track only", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage()];

    const result = await service.list(actor, trackARequest);
    expect(result.questions.map((q) => q.id)).toEqual(["q-renal-1"]);
    expect(result.images.map((i) => i.id)).toEqual(["img-renal-clean"]);
    // student payload must still be the leak-free allowlist
    expect(JSON.stringify(result)).not.toContain("correctOptionId");
  });

  it("a DIFFERENT track cannot ever see the question", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage()];

    const other = await service.list(actor, trackBRequest);
    expect(other.questions).toEqual([]);
    expect(other.images).toEqual([]);
  });

  it("an APPROVED question pointing at a same-track image surfaces only when the exam derivative is APPROVED", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage({ reviewStatus: "DRAFT", status: "DRAFT_AI" as const })];
    expect((await service.list(actor, trackARequest)).questions).toEqual([]);
  });

  it("the unbound orphan (image on another track) is filtered by the catalog join", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage({ trackId: "track-b", moduleId: "module-2" })];
    // same-track query does not surface it
    expect((await service.list(actor, trackARequest)).questions).toEqual([]);
  });

  it("legacy approved-source (sha256) rows still work when both sides share the track", async () => {
    const legacyQ = approvedQuestion({
      sourceMaterial: { ...sourceMaterial, sha256: "a".repeat(64), approvedBy: "admin-1", approvedAt: "2026-01-01T00:00:00Z" },
    });
    const legacyImg = approvedImage({
      sourceMaterial: { ...cleanMaterial, sha256: "b".repeat(64), approvedBy: "admin-1", approvedAt: "2026-01-01T00:00:00Z" },
      isExamDerivative: false,
      reviewStatus: undefined,
    });
    store.questions = [legacyQ];
    store.images = [legacyImg];
    expect((await service.list(actor, trackARequest)).images.map((i) => i.id)).toEqual(["img-renal-clean"]);
  });

  it("still enforces 401/403/404 on the same chain", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage()];
    await expect(service.list(null, trackARequest)).rejects.toMatchObject({ status: 401 });
    await expect(service.answer(null, trackARequest, "q-renal-1", "opt_0", "r")).rejects.toMatchObject({ status: 401 });
  });
});

describe("student image delivery security (Phase 12)", () => {
  let store: ScopedMemoryStore;
  let service: ReturnType<typeof createPracticalService>;
  const actor = { id: "student-1" };
  const trackARequest: RequestScope = { moduleSlug: "rau-203", subjectSlug: "anatomy", fixtures: false };
  const tracks = new Map([["rau-203/anatomy", trackA], ["rs-201/histology", trackB]]);

  beforeEach(() => {
    store = new ScopedMemoryStore();
    service = createPracticalService(store, async (_actor, moduleSlug, subjectSlug) => {
      const track = tracks.get(`${moduleSlug}/${subjectSlug}`);
      return track ? { ok: true, value: track } : { ok: false, reason: "not_found" };
    }, false);
  });

  it("lets a student fetch the APPROVED exam derivative referenced by the question", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage()];
    const image = await service.image(actor, trackARequest, "img-renal-clean");
    expect(image.id).toBe("img-renal-clean");
    expect(image.isExamDerivative).toBe(true);
  });

  it("never serves the LABELED SOURCE image, even by guessing its id", async () => {
    store.questions = [approvedQuestion()];
    store.images = [
      approvedImage(),
      { ...approvedImage(), id: "img-renal-src", storageKey: "renal-1-source.png", isExamDerivative: false, sourceImageId: null },
    ];
    await expect(service.image(actor, trackARequest, "img-renal-src")).rejects.toMatchObject({ status: 404 });
  });

  it("blocks a locked (not practice-enabled) student from the derivative", async () => {
    const locked: ResolvedPracticalTrack = { ...trackA, practiceEnabled: false };
    const lockedService = createPracticalService(store, async () => ({ ok: true, value: locked }), false);
    store.questions = [approvedQuestion()];
    store.images = [approvedImage()];
    await expect(lockedService.image(actor, { ...trackARequest, moduleSlug: locked.moduleSlug }, "img-renal-clean"))
      .rejects.toMatchObject({ status: 404 });
  });

  it("returns 404 for a nonexistent image id", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage()];
    await expect(service.image(actor, trackARequest, "does-not-exist")).rejects.toMatchObject({ status: 404 });
  });

  it("keeps track isolation: an image bound to a DIFFERENT track is not fetchable", async () => {
    store.questions = [approvedQuestion()];
    store.images = [approvedImage({ trackId: "track-b", moduleId: "module-2" })];
    await expect(service.image(actor, trackARequest, "img-renal-clean")).rejects.toMatchObject({ status: 404 });
  });
});