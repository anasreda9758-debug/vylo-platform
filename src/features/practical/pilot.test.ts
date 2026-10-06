import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDevelopmentFixtures } from "./fixtures";
import { createPracticalService, PracticalError, type PracticalStore, type RequestScope } from "./service";
import { eligibleQuestion, fixturesAllowed, gradeChoice, questionSchema, studentQuestion, type PracticalImage, type PracticalQuestion, type Progress, type ResolvedPracticalTrack } from "./model";
import { answerBody, flagBody } from "./http";
import { ospeAnswerKeysBelongToTrack } from "./ospe";

const renalTrack: ResolvedPracticalTrack = {
  id: "track-renal-anatomy", moduleId: "renal", moduleSlug: "rau-203", moduleName: "Renal & Urinary System", studyYear: 1,
  subject: "ANATOMY", subjectSlug: "anatomy", displayNameEn: "Anatomy", displayNameAr: "التشريح",
  status: "PUBLISHED", sortOrder: 0, practiceEnabled: true, ospeEnabled: false,
};
const respiratoryTrack: ResolvedPracticalTrack = {
  id: "track-respiratory-histology", moduleId: "respiratory", moduleSlug: "rs-201", moduleName: "Respiratory System", studyYear: 1,
  subject: "HISTOLOGY", subjectSlug: "histology", displayNameEn: "Histology", displayNameAr: "علم الأنسجة",
  status: "PUBLISHED", sortOrder: 0, practiceEnabled: true, ospeEnabled: true,
};

class MemoryStore implements PracticalStore {
  private renal = makeDevelopmentFixtures({ trackId: renalTrack.id, moduleId: renalTrack.moduleId, studyYear: 1, subject: "Anatomy" });
  private respiratory = makeDevelopmentFixtures({ trackId: respiratoryTrack.id, moduleId: respiratoryTrack.moduleId, studyYear: 1, subject: "Histology" });
  questions: PracticalQuestion[] = [...this.renal.questions, ...this.respiratory.questions];
  images: PracticalImage[] = [this.renal.image, this.respiratory.image];
  records = new Map<string, Progress>();
  submissions = new Map<string, string>();
  async catalog() { return { questions: this.questions, images: this.images }; }
  async progress(user: string, ids: string[]) { return ids.flatMap((id) => { const row = this.records.get(`${user}/${id}`); return row ? [{ ...row }] : []; }); }
  row(user: string, questionId: string) {
    const key = `${user}/${questionId}`;
    const row = this.records.get(key) ?? { questionId, attempts: 0, correct: 0, wrong: 0, wrongRemaining: false, bookmarked: false, difficult: false };
    this.records.set(key, row); return row;
  }
  async saveAnswer(user: string, questionId: string, optionId: string, correct: boolean, requestId: string) {
    const key = `${user}/${requestId}`, value = `${questionId}/${optionId}`;
    if (this.submissions.has(key)) {
      if (this.submissions.get(key) !== value) throw new PracticalError("Request conflict", 409);
      return;
    }
    this.submissions.set(key, value);
    const row = this.row(user, questionId); row.attempts++; row.correct += +correct; row.wrong += +!correct; row.wrongRemaining = !correct;
  }
  async setFlag(user: string, questionId: string, flag: "bookmarked" | "difficult", value: boolean) { this.row(user, questionId)[flag] = value; }
}

describe("generic practical engine", () => {
  let store: MemoryStore;
  let service: ReturnType<typeof createPracticalService>;
  let denyAccess: boolean;
  const actor = { id: "student-1" };
  const renalRequest: RequestScope = { moduleSlug: "rau-203", subjectSlug: "anatomy", fixtures: true };
  const respiratoryRequest: RequestScope = { moduleSlug: "rs-201", subjectSlug: "histology", fixtures: true };
  const tracks = [renalTrack, respiratoryTrack];

  beforeEach(() => {
    store = new MemoryStore();
    denyAccess = false;
    service = createPracticalService(store, async (_actor, moduleSlug, subjectSlug, includeDraft) => {
      if (denyAccess) return { ok: false, reason: "forbidden" };
      const track = tracks.find((item) => item.moduleSlug === moduleSlug && item.subjectSlug === subjectSlug);
      if (!track || (!includeDraft && track.status !== "PUBLISHED")) return { ok: false, reason: "not_found" };
      return { ok: true, value: track };
    }, true);
  });

  it("preserves the Renal Anatomy pilot through the generic track", async () => {
    const result = await service.list(actor, renalRequest);
    expect(result.track).toMatchObject({ moduleSlug: "rau-203", subjectSlug: "anatomy" });
    expect(result.questions).toHaveLength(10); expect(result.images).toHaveLength(1);
    expect(new Set(result.questions.map((question) => question.imageId)).size).toBe(1);
  });

  it("serves a second development-only module and subject through the same engine", async () => {
    const result = await service.list(actor, respiratoryRequest);
    expect(result.track).toMatchObject({ moduleSlug: "rs-201", subject: "HISTOLOGY", subjectSlug: "histology" });
    expect(result.questions).toHaveLength(10); expect(result.images).toHaveLength(1);
    expect(result.questions.every((question) => question.id.includes("respiratory-histology"))).toBe(true);
  });

  it("validates module and subject as one authoritative relationship", async () => {
    await expect(service.list(actor, { ...renalRequest, moduleSlug: "rs-201" })).rejects.toMatchObject({ status: 404 });
    await expect(service.list(actor, { ...renalRequest, subjectSlug: "histology" })).rejects.toMatchObject({ status: 404 });
    await expect(service.list(actor, { ...renalRequest, subjectSlug: "unknown" })).rejects.toMatchObject({ status: 404 });
  });

  it.each(["trackId", "moduleId", "studyYear"] as const)("filters mismatched catalog %s", async (field) => {
    const first = store.questions.find((question) => question.trackId === renalTrack.id)!;
    store.questions = [{ ...first, [field]: field === "studyYear" ? 2 : "other" }];
    expect((await service.list(actor, renalRequest)).questions).toEqual([]);
  });

  it("requires authentication for questions, answers, flags and images", async () => {
    await expect(service.list(null, renalRequest)).rejects.toMatchObject({ status: 401 });
    await expect(service.answer(null, renalRequest, "q", "a", "r")).rejects.toMatchObject({ status: 401 });
    await expect(service.flag(null, renalRequest, "q", "bookmarked", true)).rejects.toMatchObject({ status: 401 });
    await expect(service.image(null, renalRequest, "i")).rejects.toMatchObject({ status: 401 });
  });

  it("enforces module entitlement on every practical surface", async () => {
    denyAccess = true;
    await expect(service.list(actor, renalRequest)).rejects.toMatchObject({ status: 403 });
    await expect(service.answer(actor, renalRequest, "q", "a", "r")).rejects.toMatchObject({ status: 403 });
    await expect(service.flag(actor, renalRequest, "q", "bookmarked", true)).rejects.toMatchObject({ status: 403 });
    await expect(service.image(actor, renalRequest, "i")).rejects.toMatchObject({ status: 403 });
  });

  it("requires a linked image and a real marker in that image", async () => {
    const question = store.questions.find((item) => item.trackId === renalTrack.id)!;
    const image = store.images.find((item) => item.trackId === renalTrack.id)!;
    const scope = { trackId: renalTrack.id, moduleId: renalTrack.moduleId, studyYear: 1, fixtures: true };
    expect(eligibleQuestion(question, undefined, scope)).toBe(false);
    expect(eligibleQuestion(question, { ...image, trackId: "other" }, scope)).toBe(false);
    expect(eligibleQuestion({ ...question, markerIds: ["missing"] }, image, scope)).toBe(false);
  });

  it("validates correct option membership and exact server-side choice IDs", async () => {
    const question = store.questions.find((item) => item.trackId === renalTrack.id)!;
    expect(questionSchema.safeParse({ ...question, correctOptionId: "not-an-option" }).success).toBe(false);
    expect(questionSchema.safeParse({ ...question, options: [question.options[0], question.options[0]] }).success).toBe(false);
    expect(() => gradeChoice(question, "other-question-option")).toThrow();
    await expect(service.answer(actor, renalRequest, question.id, "Circle", "r0")).rejects.toMatchObject({ status: 400 });
    expect((await service.answer(actor, renalRequest, question.id, question.correctOptionId, "r1")).feedback.correct).toBe(true);
  });

  it("never returns the answer key or teaching feedback before a saved answer", async () => {
    const result = await service.list(actor, renalRequest);
    const serialized = JSON.stringify(result);
    for (const key of ["correctOptionId", "explanation", "identifyingClue", "commonMistake", "examTip", "sourceMaterial"]) expect(serialized).not.toContain(`"${key}"`);
    expect(studentQuestion(store.questions[0])).not.toHaveProperty("status");
    const answer = await service.answer(actor, renalRequest, result.questions[0].id, "shape-hexagon", "r");
    expect(answer.feedback).toHaveProperty("identifyingClue");
  });

  it("keeps progress and wrong questions scoped to module plus subject", async () => {
    const renalQuestion = (await service.list(actor, renalRequest)).questions[0];
    await service.answer(actor, renalRequest, renalQuestion.id, "shape-hexagon", "renal-wrong");
    expect((await service.list(actor, renalRequest, true)).questions.map((question) => question.id)).toEqual([renalQuestion.id]);
    expect((await service.list(actor, respiratoryRequest, true)).questions).toEqual([]);
    expect((await service.list(actor, respiratoryRequest)).summary.attempted).toBe(0);
    const stored = store.questions.find((question) => question.id === renalQuestion.id)!;
    await service.answer(actor, renalRequest, renalQuestion.id, stored.correctOptionId, "renal-retry");
    expect((await service.list(actor, renalRequest, true)).questions).toEqual([]);
  });

  it("isolates wrong queues, flags and statistics across users", async () => {
    const question = (await service.list(actor, renalRequest)).questions[0];
    await service.answer(actor, renalRequest, question.id, "shape-hexagon", "shared-request-id");
    await service.flag(actor, renalRequest, question.id, "bookmarked", true);
    await service.flag(actor, renalRequest, question.id, "difficult", true);
    const other = await service.list({ id: "student-2" }, renalRequest, true);
    expect(other.questions).toEqual([]); expect(other.progress).toEqual([]); expect(other.summary.attempted).toBe(0);
  });

  it("does not count a retried request twice", async () => {
    const question = store.questions.find((item) => item.trackId === renalTrack.id)!;
    await service.answer(actor, renalRequest, question.id, question.correctOptionId, "same");
    await service.answer(actor, renalRequest, question.id, question.correctOptionId, "same");
    expect((await service.list(actor, renalRequest)).summary.attempted).toBe(1);
    await expect(service.answer(actor, renalRequest, question.id, "shape-hexagon", "same")).rejects.toMatchObject({ status: 409 });
  });

  it("does not reveal feedback if answer persistence fails", async () => {
    vi.spyOn(store, "saveAnswer").mockRejectedValueOnce(new Error("database unavailable"));
    const question = store.questions.find((item) => item.trackId === renalTrack.id)!;
    await expect(service.answer(actor, renalRequest, question.id, question.correctOptionId, "r")).rejects.toThrow("database unavailable");
    expect((await service.list(actor, renalRequest)).summary.attempted).toBe(0);
  });

  it("keeps DRAFT_AI and unapproved sources out of production", async () => {
    expect((await service.list(actor, { ...renalRequest, fixtures: false })).questions).toEqual([]);
    const question = store.questions.find((item) => item.trackId === renalTrack.id)!;
    const image = store.images.find((item) => item.trackId === renalTrack.id)!;
    const source = { ...question.sourceMaterial, sha256: "a".repeat(64), approvedBy: "reviewer", approvedAt: "2026-09-08" };
    store.questions = [{ ...question, isFixture: false, status: "APPROVED", sourceMaterial: source }];
    store.images = [{ ...image, isFixture: false, status: "APPROVED", sourceMaterial: source }];
    expect((await service.list(actor, { ...renalRequest, fixtures: false })).questions).toHaveLength(1);
    store.images[0].status = "REVIEWED";
    expect((await service.list(actor, { ...renalRequest, fixtures: false })).questions).toHaveLength(0);
  });

  it("cannot enable development fixtures in production", async () => {
    expect(fixturesAllowed("production", true)).toBe(false);
    expect(fixturesAllowed("development", true)).toBe(true);
    const productionService = createPracticalService(store, async () => ({ ok: true, value: renalTrack }), false);
    await expect(productionService.list(actor, renalRequest)).rejects.toMatchObject({ status: 404 });
  });

  it("validates explicit OSPE station-to-track relationships", () => {
    expect(ospeAnswerKeysBelongToTrack(["renal-anatomy-1", "renal-anatomy-2"], ["renal-anatomy-1", "renal-anatomy-2"])).toBe(true);
    expect(ospeAnswerKeysBelongToTrack(["renal-anatomy-1", "renal-histology-1"], ["renal-anatomy-1"])).toBe(false);
    expect(ospeAnswerKeysBelongToTrack([null], ["renal-anatomy-1"])).toBe(false);
  });

  it("rejects user IDs, correctness and unsupported formats supplied by clients", () => {
    const body = { questionId: "q", optionId: "a", requestId: "00000000-0000-4000-8000-000000000000" };
    expect(answerBody.safeParse(body).success).toBe(true);
    for (const extra of [{ userId: "another-user" }, { correctOptionId: "a" }, { correct: true }, { answerFormat: "SHORT_ANSWER" }]) expect(answerBody.safeParse({ ...body, ...extra }).success).toBe(false);
    expect(flagBody.safeParse({ questionId: "q", flag: "bookmarked", value: true, userId: "another-user" }).success).toBe(false);
  });
});
