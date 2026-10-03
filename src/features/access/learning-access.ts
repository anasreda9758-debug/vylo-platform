import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/shared/db";
import { hasModuleAccess } from "@/features/billing/queries";
import { curriculumModule, lecture } from "@/features/curriculum/schema";
import { question, questionBank, questionOption, questionReview, quizAttempt } from "@/features/practice/schema";
import { clinicalCase, flashcard } from "@/features/review/schema";
import { ospeExam, ospeExamStation, practicalTrackOspeStation } from "@/features/ospe/schema";
import { OSPE_FOLDER_TO_MODULE } from "@/features/ospe/data";
import { practicalTrack } from "@/features/practical/schema";
import { ospeAnswerKeysBelongToTrack } from "@/features/practical/ospe";
import { isModuleAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";

export type LearningActor = {
  id: string;
  role?: string | null;
};

type ModuleRecord = typeof curriculumModule.$inferSelect;
type ModuleAccessTarget = Pick<ModuleRecord, "id" | "slug" | "isFree" | "term"> & Partial<Pick<ModuleRecord, "academicPeriodId">>;
type AccessibleLecture = typeof lecture.$inferSelect & { module: ModuleRecord };
type AccessibleQuestionBank = typeof questionBank.$inferSelect & { module: ModuleRecord };
type AccessibleQuestion = typeof question.$inferSelect & {
  bank: AccessibleQuestionBank;
  options: (typeof questionOption.$inferSelect)[];
};
type AccessibleQuizAttempt = typeof quizAttempt.$inferSelect & { bank: AccessibleQuestionBank };
type AccessibleOspeExam = typeof ospeExam.$inferSelect & {
  stations: (typeof ospeExamStation.$inferSelect)[];
};

export type AccessDecision<T> =
  | { ok: true; value: T; access: "full" | "preview" }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "not_found" };

type LectureAccessOptions = {
  allowPreview?: boolean;
};

const unauthenticated = <T>(): AccessDecision<T> => ({ ok: false, reason: "unauthenticated" });
const forbidden = <T>(): AccessDecision<T> => ({ ok: false, reason: "forbidden" });
const notFound = <T>(): AccessDecision<T> => ({ ok: false, reason: "not_found" });
const allowed = <T>(value: T, access: "full" | "preview" = "full"): AccessDecision<T> => ({
  ok: true,
  value,
  access,
});

/**
 * Pure policy used by the database-backed helpers below and their unit tests.
 * Admin access is deliberately explicit; all other users need a free module or
 * a currently valid entitlement.
 */
export function decideModuleAccess(
  actor: LearningActor | null | undefined,
  module: Pick<ModuleAccessTarget, "isFree">,
  hasValidEntitlement: boolean,
): AccessDecision<undefined> {
  if (!actor) return unauthenticated();
  if (actor.role === "admin" || module.isFree || hasValidEntitlement) return allowed(undefined);
  return forbidden();
}

/** Preview is intentionally limited to the actual first lecture resolved from DB. */
export function canUseLecturePreview(
  lectureId: string,
  firstLectureId: string | undefined,
  allowPreview: boolean,
) {
  return allowPreview && firstLectureId === lectureId;
}

/** Do not allow a caller to submit a question into a different bank/attempt. */
export function questionBelongsToBank(questionBankId: string, expectedBankId: string) {
  return questionBankId === expectedBankId;
}

/** A private learning record must never be usable across user accounts. */
export function isResourceOwner(
  actor: LearningActor | null | undefined,
  ownerId: string,
) {
  return Boolean(actor && actor.id === ownerId);
}

export async function canAccessModule(
  actor: LearningActor | null | undefined,
  module: ModuleAccessTarget,
): Promise<AccessDecision<undefined>> {
  if (!actor) return unauthenticated();
  if (actor.role === "admin") return allowed(undefined);
  if (!(await isModuleAcademicallyVisible(actor, module))) return notFound();
  const hasEntitlement = await hasModuleAccess(actor.id, module);
  return decideModuleAccess(actor, module, hasEntitlement);
}

export async function getAccessibleModuleBySlug(
  actor: LearningActor | null | undefined,
  slug: string,
): Promise<AccessDecision<ModuleRecord>> {
  if (!actor) return unauthenticated<never>();
  const moduleRow = await db.query.curriculumModule.findFirst({
    where: eq(curriculumModule.slug, slug),
  });
  if (!moduleRow) return notFound<ModuleRecord>();
  const decision = await canAccessModule(actor, moduleRow);
  return decision.ok ? allowed<ModuleRecord>(moduleRow) : forbidden<ModuleRecord>();
}

export async function getAccessibleLecture(
  actor: LearningActor | null | undefined,
  lectureId: string,
  { allowPreview = true }: LectureAccessOptions = {},
): Promise<AccessDecision<AccessibleLecture>> {
  if (!actor) return unauthenticated<never>();

  const lectureRow = await db.query.lecture.findFirst({
    where: eq(lecture.id, lectureId),
    with: { module: true },
  });
  if (!lectureRow?.module) return notFound<AccessibleLecture>();
  const accessibleLecture = lectureRow as AccessibleLecture;

  // Academic visibility precedes entitlement AND the first-lecture free preview.
  if (!(await isModuleAcademicallyVisible(actor, accessibleLecture.module))) return notFound();

  const moduleDecision = await canAccessModule(actor, accessibleLecture.module);
  if (moduleDecision.ok) return allowed<AccessibleLecture>(accessibleLecture);

  const firstLecture = await db.query.lecture.findFirst({
    where: eq(lecture.moduleId, accessibleLecture.module.id),
    orderBy: [asc(lecture.order)],
    columns: { id: true },
  });
  if (canUseLecturePreview(accessibleLecture.id, firstLecture?.id, allowPreview)) {
    return allowed<AccessibleLecture>(accessibleLecture, "preview");
  }
  return forbidden<AccessibleLecture>();
}

export async function getAccessibleQuestionBankBySlug(
  actor: LearningActor | null | undefined,
  slug: string,
): Promise<AccessDecision<AccessibleQuestionBank>> {
  if (!actor) return unauthenticated<never>();
  const bank = await db.query.questionBank.findFirst({
    where: eq(questionBank.slug, slug),
    with: { module: true },
  });
  if (!bank?.module) return notFound<AccessibleQuestionBank>();
  const accessibleBank = bank as AccessibleQuestionBank;
  const decision = await canAccessModule(actor, accessibleBank.module);
  return decision.ok ? allowed<AccessibleQuestionBank>(accessibleBank) : forbidden<AccessibleQuestionBank>();
}

export async function getAccessibleQuestionBankById(
  actor: LearningActor | null | undefined,
  bankId: string,
): Promise<AccessDecision<AccessibleQuestionBank>> {
  if (!actor) return unauthenticated<never>();
  const bank = await db.query.questionBank.findFirst({
    where: eq(questionBank.id, bankId),
    with: { module: true },
  });
  if (!bank?.module) return notFound<AccessibleQuestionBank>();
  const accessibleBank = bank as AccessibleQuestionBank;
  const decision = await canAccessModule(actor, accessibleBank.module);
  return decision.ok ? allowed<AccessibleQuestionBank>(accessibleBank) : forbidden<AccessibleQuestionBank>();
}

export async function getAccessibleQuestion(
  actor: LearningActor | null | undefined,
  questionId: string,
): Promise<AccessDecision<AccessibleQuestion>> {
  if (!actor) return unauthenticated<never>();
  const questionRow = await db.query.question.findFirst({
    where: eq(question.id, questionId),
    with: {
      bank: { with: { module: true } },
      options: { orderBy: (option, { asc: orderAsc }) => [orderAsc(option.order)] },
    },
  });
  if (!questionRow?.bank?.module) return notFound<AccessibleQuestion>();
  const accessibleQuestion = questionRow as AccessibleQuestion;
  const decision = await canAccessModule(actor, accessibleQuestion.bank.module);
  return decision.ok ? allowed<AccessibleQuestion>(accessibleQuestion) : forbidden<AccessibleQuestion>();
}

export async function getAccessibleQuizAttempt(
  actor: LearningActor | null | undefined,
  attemptId: string,
): Promise<AccessDecision<AccessibleQuizAttempt>> {
  if (!actor) return unauthenticated<never>();
  const attempt = await db.query.quizAttempt.findFirst({
    where: eq(quizAttempt.id, attemptId),
    with: { bank: { with: { module: true } } },
  });
  // A different user's attempt is deliberately indistinguishable from absent.
  if (!attempt?.bank?.module || !isResourceOwner(actor, attempt.userId)) return notFound<AccessibleQuizAttempt>();
  const accessibleAttempt = attempt as AccessibleQuizAttempt;
  const decision = await canAccessModule(actor, accessibleAttempt.bank.module);
  return decision.ok ? allowed<AccessibleQuizAttempt>(accessibleAttempt) : forbidden<AccessibleQuizAttempt>();
}

export async function getAccessibleQuestionReview(
  actor: LearningActor | null | undefined,
  questionId: string,
): Promise<AccessDecision<{
  review: typeof questionReview.$inferSelect;
  question: AccessibleQuestion;
}>> {
  if (!actor) return unauthenticated<never>();
  const [review] = await db
    .select()
    .from(questionReview)
    .where(and(eq(questionReview.userId, actor.id), eq(questionReview.questionId, questionId)))
    .limit(1);
  if (!review || !isResourceOwner(actor, review.userId)) return notFound<{
    review: typeof questionReview.$inferSelect;
    question: AccessibleQuestion;
  }>();

  const questionDecision = await getAccessibleQuestion(actor, questionId);
  if (!questionDecision.ok) return questionDecision;
  return allowed({ review, question: questionDecision.value });
}

export async function getAccessibleFlashcard(
  actor: LearningActor | null | undefined,
  cardId: string,
): Promise<AccessDecision<{
  card: typeof flashcard.$inferSelect;
  lecture: AccessibleLecture;
}>> {
  if (!actor) return unauthenticated<never>();
  const card = await db.query.flashcard.findFirst({
    where: eq(flashcard.id, cardId),
  });
  if (!card || !isResourceOwner(actor, card.userId)) return notFound<{
    card: typeof flashcard.$inferSelect;
    lecture: AccessibleLecture;
  }>();
  const lectureDecision = await getAccessibleLecture(actor, card.lectureId, { allowPreview: false });
  if (!lectureDecision.ok) return lectureDecision;
  return allowed({ card, lecture: lectureDecision.value });
}

export async function getAccessibleClinicalCase(
  actor: LearningActor | null | undefined,
  caseId: string,
): Promise<AccessDecision<{
  case: typeof clinicalCase.$inferSelect;
  lecture: AccessibleLecture;
}>> {
  if (!actor) return unauthenticated<never>();
  const caseRow = await db.query.clinicalCase.findFirst({
    where: eq(clinicalCase.id, caseId),
  });
  if (!caseRow || !isResourceOwner(actor, caseRow.userId)) return notFound<{
    case: typeof clinicalCase.$inferSelect;
    lecture: AccessibleLecture;
  }>();
  const lectureDecision = await getAccessibleLecture(actor, caseRow.lectureId, { allowPreview: false });
  if (!lectureDecision.ok) return lectureDecision;
  return allowed({ case: caseRow, lecture: lectureDecision.value });
}

export function getOspeModuleSlug(folder: string) {
  return OSPE_FOLDER_TO_MODULE[folder] ?? null;
}

export async function getAccessibleOspeFolder(
  actor: LearningActor | null | undefined,
  folder: string,
): Promise<AccessDecision<{ folder: string; module: ModuleRecord }>> {
  if (!actor) return unauthenticated<never>();
  const moduleSlug = getOspeModuleSlug(folder);
  if (!moduleSlug) return notFound<never>();
  const moduleRow = await db.query.curriculumModule.findFirst({
    where: eq(curriculumModule.slug, moduleSlug),
  });
  if (!moduleRow) return notFound<{ folder: string; module: ModuleRecord }>();
  const decision = await canAccessModule(actor, moduleRow);
  return decision.ok
    ? allowed<{ folder: string; module: ModuleRecord }>({ folder, module: moduleRow })
    : forbidden<{ folder: string; module: ModuleRecord }>();
}

export async function getAccessibleOspeFolders(
  actor: LearningActor | null | undefined,
): Promise<AccessDecision<{ folder: string; module: ModuleRecord }[]>> {
  if (!actor) return unauthenticated<never>();
  const folders = Object.keys(OSPE_FOLDER_TO_MODULE);
  const slugs = [...new Set(Object.values(OSPE_FOLDER_TO_MODULE))];
  const modules = await db.query.curriculumModule.findMany({
    where: inArray(curriculumModule.slug, slugs),
  });
  const moduleBySlug = new Map(modules.map((moduleRow) => [moduleRow.slug, moduleRow]));
  const accessible: { folder: string; module: ModuleRecord }[] = [];

  for (const folder of folders) {
    const moduleRow = moduleBySlug.get(OSPE_FOLDER_TO_MODULE[folder]);
    if (!moduleRow) continue;
    const decision = await canAccessModule(actor, moduleRow);
    if (decision.ok) accessible.push({ folder, module: moduleRow });
  }
  return allowed(accessible);
}

export async function getAccessibleOspeExam(
  actor: LearningActor | null | undefined,
  examId: string,
): Promise<AccessDecision<AccessibleOspeExam>> {
  if (!actor) return unauthenticated<never>();
  const exam = await db.query.ospeExam.findFirst({
    where: eq(ospeExam.id, examId),
    with: { stations: { orderBy: (station, { asc: orderAsc }) => [orderAsc(station.order)] } },
  });
  if (!exam || !isResourceOwner(actor, exam.userId)) return notFound<AccessibleOspeExam>();
  const accessibleExam = exam as AccessibleOspeExam;

  if (accessibleExam.practicalTrackId) {
    const [scope] = await db.select({ track: practicalTrack, module: curriculumModule }).from(practicalTrack)
      .innerJoin(curriculumModule, eq(practicalTrack.moduleId, curriculumModule.id))
      .where(eq(practicalTrack.id, accessibleExam.practicalTrackId)).limit(1);
    if (!scope) return notFound<AccessibleOspeExam>();
    const moduleDecision = await canAccessModule(actor, scope.module);
    if (!moduleDecision.ok) return moduleDecision;
    const associations = await db.select({ answerKeyId: practicalTrackOspeStation.answerKeyId }).from(practicalTrackOspeStation)
      .where(eq(practicalTrackOspeStation.trackId, accessibleExam.practicalTrackId));
    if (!ospeAnswerKeysBelongToTrack(accessibleExam.stations.map((station) => station.answerKeyId), associations.map((row) => row.answerKeyId))) {
      return notFound<AccessibleOspeExam>();
    }
    return allowed<AccessibleOspeExam>(accessibleExam);
  }

  for (const station of accessibleExam.stations) {
    const decision = await getAccessibleOspeFolder(actor, station.folder);
    if (!decision.ok) return decision;
  }
  return allowed<AccessibleOspeExam>(accessibleExam);
}
