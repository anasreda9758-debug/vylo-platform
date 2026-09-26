import { asc, eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { practicalImage, practicalQuestion } from "./schema";
import { imageSchema, questionSchema, type PracticalImage } from "./model";

export type AuthoringStatus = "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";

type QuestionRow = typeof practicalQuestion.$inferSelect;

/**
 * Case-insensitive dedupe key: strips whitespace/punctuation so
 * "left ventricle" vs "Left Ventricle" collapse to the same choice.
 */
export function normalizeChoice(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/gi, "");
}

export type FiveOptionResult =
  | { ok: true; options: { id: string; text: string }[]; correctOptionId: string; needsReview: boolean };

/**
 * Builds exactly five single-choice options: the ADMIN-VERIFIED correct
 * structure is always option 0; the remaining slots are filled from AI
 * distractors. Blank/duplicate/"same-as-correct" ideas are dropped. When
 * fewer than four usable distractors arrive the question still exists but is
 * flagged NEEDS_REVIEW (an admin completes the choices manually).
 */
export function buildFiveOptions(correctStructure: string, distractors: string[]): FiveOptionResult {
  const correct = correctStructure.trim();
  if (!correct) {
    return { ok: true, options: [{ id: "opt_0", text: "" }], correctOptionId: "opt_0", needsReview: true };
  }
  const seen = new Set<string>([normalizeChoice(correct)]);
  const options = [{ id: "opt_0", text: correct }];
  for (const d of distractors) {
    if (options.length >= 5) break;
    const text = (d ?? "").trim();
    if (!text) continue;
    const key = normalizeChoice(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({ id: `opt_${options.length}`, text });
  }
  return { ok: true, options, correctOptionId: "opt_0", needsReview: options.length !== 5 };
}

/** Returns the pixel position of an arrow tip for normalized (0..1) coordinates. */
export function targetPosition(x: number, y: number, width: number, height: number) {
  const px = Math.max(0, Math.min(1, x)) * width;
  const py = Math.max(0, Math.min(1, y)) * height;
  // Percentages stay invariant to element size (320..1440px verified in tests).
  return { leftPct: (px / width) * 100, topPct: (py / height) * 100, px, py };
}

/**
 * Approval gate. A generated question may ONLY reach students when:
 * - the verified structure is set
 * - the clean EXAM image exists and is student-safe (real storage key)
 * - there are exactly 5 distinct options with exactly one correct id
 */
export function isApprovalReady(input: {
  correctStructure: string | null;
  options: { id: string; text: string }[];
  correctOptionId: string;
  examImageId: string | null;
  examStorageKey: string | null | undefined;
}): boolean {
  if (!input.correctStructure || input.correctStructure.trim().length === 0) return false;
  if (!input.examImageId || !input.examStorageKey || input.examStorageKey.trim().length === 0) return false;
  const options = input.options ?? [];
  if (options.length !== 5) return false;
  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== 5) return false;
  const correctCount = options.filter((o) => o.id === input.correctOptionId).length;
  return correctCount === 1 && input.options.filter((o) => o.text.trim().length === 0).length === 0;
}

export async function getAuthoringCatalog(moduleId?: string) {
  const images = await db
    .select()
    .from(practicalImage)
    .where(moduleId ? eq(practicalImage.moduleId, moduleId) : undefined)
    .orderBy(asc(practicalImage.studyYear), asc(practicalImage.subject), asc(practicalImage.alt));

  const imageIds = images.map((i) => i.id);
  const questions = imageIds.length
    ? await db.select().from(practicalQuestion).where(undefined)
    : [];
  const byImage = new Map<string, typeof questions>();
  for (const q of questions) {
    const key = q.examImageId ?? q.imageId;
    const list = byImage.get(key) ?? [];
    list.push(q);
    byImage.set(key, list);
  }
  return images.map((image) => {
    const parsed = imageSchema.safeParse(image);
    const raw = image as unknown as PracticalImage & {
      source_image_id: string | null;
      exam_image_id: string | null;
      target_x: number | null;
      target_y: number | null;
      is_exam_derivative: boolean;
      generation_status: string;
      review_status: string;
      generated_by_ai: boolean;
    };
    return {
      image: parsed.success ? parsed.data : null,
      raw,
      questions: (byImage.get(image.id) ?? []).map((q) => {
        const qParsed = questionSchema.safeParse(q);
        const r = q as unknown as QuestionRow & {
          source_image_id: string | null;
          exam_image_id: string | null;
          target_x: number | null;
          target_y: number | null;
          correct_structure: string | null;
          generation_request_id: string | null;
          generation_status: string;
          review_status: string;
          generated_by_ai: boolean;
        };
        return { question: qParsed.success ? qParsed.data : null, raw: r };
      }),
    };
  });
}

export async function setImageStatus(
  imageId: string,
  status: "APPROVED" | "REJECTED",
): Promise<{ ok: boolean; reason?: "not_found" | "not_approval_ready" }> {
  const [image] = await db.select().from(practicalImage).where(eq(practicalImage.id, imageId)).limit(1);
  if (!image) return { ok: false, reason: "not_found" };
  if (status === "APPROVED" && !image.storageKey) return { ok: false, reason: "not_approval_ready" };
  await db
    .update(practicalImage)
    .set({
      status: (status === "APPROVED" ? "APPROVED" : "DRAFT_AI") as PracticalImage["status"],
      reviewStatus: status,
    })
    .where(eq(practicalImage.id, imageId));
  return { ok: true };
}

export async function updateQuestionTarget(
  questionId: string,
  targetX: number,
  targetY: number,
): Promise<{ ok: boolean; reason?: "not_found" | "invalid_target" }> {
  if (targetX < 0 || targetX > 1 || targetY < 0 || targetY > 1) {
    return { ok: false, reason: "invalid_target" };
  }
  const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, questionId)).limit(1);
  if (!question) return { ok: false, reason: "not_found" };
  await db
    .update(practicalQuestion)
    .set({ targetX, targetY, status: "DRAFT_AI", reviewStatus: "DRAFT" })
    .where(eq(practicalQuestion.id, questionId));
  return { ok: true };
}

export async function setQuestionStructure(
  questionId: string,
  correctStructure: string,
): Promise<{ ok: boolean; reason?: "not_found" | "missing_correct_choice" }> {
  const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, questionId)).limit(1);
  if (!question) return { ok: false, reason: "not_found" };
  const structure = correctStructure.trim();
  if (!structure) return { ok: false, reason: "missing_correct_choice" };
  // The verified structure must exist among the question's own options.
  const options = (question.options ?? []) as { id: string; text: string }[];
  const exists = options.some((o) => normalizeChoice(o.text) === normalizeChoice(structure));
  if (!exists) return { ok: false, reason: "missing_correct_choice" };
  await db
    .update(practicalQuestion)
    .set({ correctStructure: structure, status: "DRAFT_AI", reviewStatus: "DRAFT" })
    .where(eq(practicalQuestion.id, questionId));
  return { ok: true };
}

export async function setExamImage(
  questionId: string,
  examImageId: string,
): Promise<{ ok: boolean; reason?: "not_found" | "exam_image_not_found" | "exam_image_track_mismatch" }> {
  const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, questionId)).limit(1);
  if (!question) return { ok: false, reason: "not_found" };
  const [image] = await db.select().from(practicalImage).where(eq(practicalImage.id, examImageId)).limit(1);
  if (!image || !image.storageKey) return { ok: false, reason: "exam_image_not_found" };
  // The student catalog inner-joins on practical_track_id: an exam image from a
  // different (or missing) track would silently unbind an approved question.
  if (!image.trackId || image.trackId !== question.trackId) return { ok: false, reason: "exam_image_track_mismatch" };
  // Students only ever see the CLEAN exam image; the labeled source is never used.
  await db
    .update(practicalQuestion)
    .set({ imageId: examImageId, examImageId, status: "DRAFT_AI", reviewStatus: "DRAFT" })
    .where(eq(practicalQuestion.id, questionId));
  return { ok: true };
}

export async function setCorrectOption(
  questionId: string,
  optionId: string,
): Promise<{ ok: boolean; reason?: "not_found" | "unknown_option" }> {
  const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, questionId)).limit(1);
  if (!question) return { ok: false, reason: "not_found" };
  const options = (question.options ?? []) as { id: string; text: string }[];
  if (!options.some((o) => o.id === optionId)) return { ok: false, reason: "unknown_option" };
  await db
    .update(practicalQuestion)
    .set({ correctOptionId: optionId, status: "DRAFT_AI", reviewStatus: "DRAFT" })
    .where(eq(practicalQuestion.id, questionId));
  return { ok: true };
}

export async function replaceOptions(
  questionId: string,
  options: { id: string; text: string }[],
  correctOptionId: string,
): Promise<{ ok: boolean; reason?: "not_found" | "requires_exactly_five" | "invalid_options" }> {
  const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, questionId)).limit(1);
  if (!question) return { ok: false, reason: "not_found" };
  const cleaned = options.map((o) => ({ id: o.id, text: o.text.trim() }));
  const ids = cleaned.map((o) => o.id);
  if (cleaned.length !== 5 || new Set(ids).size !== 5 || !ids.includes(correctOptionId)) {
    return { ok: false, reason: "requires_exactly_five" };
  }
  if (cleaned.some((o) => !o.id || !o.text)) return { ok: false, reason: "invalid_options" };
  await db
    .update(practicalQuestion)
    .set({ options: cleaned, correctOptionId, status: "DRAFT_AI", reviewStatus: "DRAFT" })
    .where(eq(practicalQuestion.id, questionId));
  return { ok: true };
}

export async function setQuestionStatus(
  questionId: string,
  status: "APPROVED" | "REJECTED",
): Promise<{ ok: boolean; reason?: "not_found" | "not_approval_ready" }> {
  const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, questionId)).limit(1);
  if (!question) return { ok: false, reason: "not_found" };

  if (status === "APPROVED") {
    const [image] = await db
      .select()
      .from(practicalImage)
      .where(eq(practicalImage.id, question.imageId))
      .limit(1);
    const ready = isApprovalReady({
      correctStructure: question.correctStructure,
      options: (question.options ?? []) as { id: string; text: string }[],
      correctOptionId: question.correctOptionId,
      examImageId: question.examImageId,
      examStorageKey: image?.storageKey,
    });
    if (!ready) return { ok: false, reason: "not_approval_ready" };
    // The approved question must actually be reachable: the question and its
    // student-facing image share the SAME practical track (store catalog
    // inner-joins on practical_track_id for both).
    if (!question.trackId || !image?.trackId || image.trackId !== question.trackId) {
      return { ok: false, reason: "not_approval_ready" };
    }
  }

  await db
    .update(practicalQuestion)
    .set({ status: (status === "APPROVED" ? "APPROVED" : "DRAFT_AI") as QuestionRow["status"], reviewStatus: status })
    .where(eq(practicalQuestion.id, questionId));
  return { ok: true };
}