import {
  eligibleQuestion, gradeChoice, imageSchema, questionSchema, studentQuestion, summarizeProgress,
  type Scope, type Progress, type PracticalTrackResolution,
} from "./model";

export class PracticalError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export type Actor = { id: string; role?: string | null };
export interface PracticalStore {
  catalog(scope: Scope): Promise<{ questions: unknown[]; images: unknown[] }>;
  progress(userId: string, questionIds: string[]): Promise<Progress[]>;
  saveAnswer(userId: string, questionId: string, optionId: string, correct: boolean, requestId: string): Promise<void>;
  setFlag(userId: string, questionId: string, flag: "bookmarked" | "difficult", value: boolean): Promise<void>;
}
type ResolveTrack = (actor: Actor, moduleSlug: string, subjectSlug: string, includeDraft: boolean) => Promise<PracticalTrackResolution>;
export type RequestScope = { moduleSlug: string; subjectSlug: string; fixtures: boolean };

export function createPracticalService(store: PracticalStore, resolveTrack: ResolveTrack, allowFixtures: boolean) {
  async function load(actor: Actor | null, request: RequestScope) {
    if (!actor) throw new PracticalError("Sign in required", 401);
    if (request.fixtures && !allowFixtures) throw new PracticalError("Development fixtures are disabled", 404);
    const resolution = await resolveTrack(actor, request.moduleSlug, request.subjectSlug, request.fixtures);
    if (!resolution.ok) {
      const status = resolution.reason === "unauthenticated" ? 401 : resolution.reason === "forbidden" ? 403 : 404;
      throw new PracticalError(status === 403 ? "Module access required" : status === 401 ? "Sign in required" : "Practical subject not available", status);
    }
    const track = resolution.value;
    if (!track.practiceEnabled) throw new PracticalError("Practice is not available for this subject", 404);
    const scope: Scope = { trackId: track.id, moduleId: track.moduleId, studyYear: track.studyYear, fixtures: request.fixtures };
    const data = await store.catalog(scope);
    const images = data.images.flatMap((i) => { const p = imageSchema.safeParse(i); return p.success ? [p.data] : []; });
    const questions = data.questions.flatMap((q) => { const p = questionSchema.safeParse(q); return p.success ? [p.data] : []; })
      .filter((q) => eligibleQuestion(q, images.find((i) => i.id === q.imageId), scope))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return { scope, track, questions, images: images.filter((i) => questions.some((q) => q.imageId === i.id)) };
  }
  return {
    async list(actor: Actor | null, request: RequestScope, wrongOnly = false) {
      const data = await load(actor, request);
      const progress = await store.progress(actor!.id, data.questions.map((q) => q.id));
      const questions = wrongOnly ? data.questions.filter((q) => progress.some((p) => p.questionId === q.id && p.wrongRemaining)) : data.questions;
      const query = new URLSearchParams({ module: request.moduleSlug, subject: request.subjectSlug, fixtures: request.fixtures ? "1" : "0" });
      return {
        questions: questions.map(studentQuestion),
        images: data.images.filter((i) => questions.some((q) => q.imageId === i.id)).map((i) => ({
          id: i.id, alt: i.alt, markers: i.markers,
          url: `/api/practical/images/${encodeURIComponent(i.id)}?${query}`,
        })),
        progress, summary: summarizeProgress(progress), fixtures: request.fixtures, studyYear: data.scope.studyYear,
        track: {
          id: data.track.id,
          moduleSlug: data.track.moduleSlug,
          moduleName: data.track.moduleName,
          subject: data.track.subject,
          subjectSlug: data.track.subjectSlug,
          displayNameEn: data.track.displayNameEn,
          displayNameAr: data.track.displayNameAr,
          ospeEnabled: data.track.ospeEnabled,
        },
      };
    },
    async answer(actor: Actor | null, request: RequestScope, questionId: string, optionId: string, requestId: string) {
      const data = await load(actor, request);
      const question = data.questions.find((q) => q.id === questionId);
      if (!question) throw new PracticalError("Question not available", 404);
      if (!question.options.some((o) => o.id === optionId)) throw new PracticalError("Option does not belong to this question", 400);
      const feedback = gradeChoice(question, optionId);
      // Feedback is returned only after the transaction commits successfully.
      await store.saveAnswer(actor!.id, questionId, optionId, feedback.correct, requestId);
      const progress = await store.progress(actor!.id, data.questions.map((q) => q.id));
      return { feedback, progress, summary: summarizeProgress(progress) };
    },
    async flag(actor: Actor | null, request: RequestScope, questionId: string, flag: "bookmarked" | "difficult", value: boolean) {
      const data = await load(actor, request);
      if (!data.questions.some((q) => q.id === questionId)) throw new PracticalError("Question not available", 404);
      await store.setFlag(actor!.id, questionId, flag, value);
      return { ok: true };
    },
    async image(actor: Actor | null, request: RequestScope, imageId: string) {
      const data = await load(actor, request);
      const image = data.images.find((i) => i.id === imageId);
      if (!image) throw new PracticalError("Image not available", 404);
      return image;
    },
  };
}
