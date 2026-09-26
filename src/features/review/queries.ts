import { and, eq, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import { clinicalCase, clinicalCaseEvaluation, flashcard } from "./schema";
import { canAccessModule, type LearningActor } from "@/features/access/learning-access";

export type ReviewLecture = {
  id: string;
  title: string;
  subject: string | null;
  moduleName: string;
  moduleSlug: string;
};

// Lectures the user can generate flashcards/cases from: accessible modules
// (free always, unlocked when subscribed) that have readable content.
export async function listLecturesForReview(user: LearningActor): Promise<ReviewLecture[]> {
  const modules = await db.query.curriculumModule.findMany({
    orderBy: (m, { asc }) => [asc(m.order)],
    with: {
      lectures: {
        orderBy: (l, { asc }) => [asc(l.order)],
      },
    },
  });

  const out: ReviewLecture[] = [];
  for (const m of modules) {
    if (!(await canAccessModule(user, m)).ok) continue;
    for (const l of m.lectures) {
      if (!l.content || l.content.trim().length === 0) continue;
      out.push({
        id: l.id,
        title: l.title,
        subject: l.subject,
        moduleName: m.name,
        moduleSlug: m.slug,
      });
    }
  }
  return out;
}

export async function createFlashcards(
  userId: string,
  lectureId: string,
  cards: { front: string; back: string }[],
) {
  if (cards.length === 0) return 0;
  const due = new Date();
  await db.insert(flashcard).values(
    cards.map((c) => ({
      id: randomUUID(),
      userId,
      lectureId,
      front: c.front,
      back: c.back,
      intervalDays: 1,
      dueDate: due,
    })),
  );
  return cards.length;
}

export async function getDueFlashcards(userId: string, limit = 30) {
  return db.query.flashcard.findMany({
    where: and(eq(flashcard.userId, userId), lte(flashcard.dueDate, new Date())),
    orderBy: (f, { asc }) => [asc(f.dueDate)],
    limit,
    with: { lecture: true },
  });
}

export async function reviewFlashcard(
  cardId: string,
  userId: string,
  rating: "again" | "good" | "easy",
): Promise<{ wasDue: boolean }> {
  const intervals = { again: 1, good: 3, easy: 7 } as const;
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT due_date FROM flashcard
      WHERE id = ${cardId} AND user_id = ${userId}
      FOR UPDATE
    `)) as { due_date?: Date }[];
    const dueDate = rows[0]?.due_date ? new Date(rows[0].due_date) : null;
    const wasDue = dueDate ? dueDate.getTime() <= now.getTime() : false;
    const due = new Date();
    due.setDate(due.getDate() + intervals[rating]);
    await tx.execute(sql`
      UPDATE flashcard
      SET interval_days = ${intervals[rating]}, due_date = ${due}
      WHERE id = ${cardId} AND user_id = ${userId}
    `);
    return { wasDue };
  });
}

export async function createClinicalCase(
  userId: string,
  lectureId: string,
  caseData: { case: string; questions: string[]; model_answers: string[] },
) {
  const id = randomUUID();
  await db.insert(clinicalCase).values({
    id,
    userId,
    lectureId,
    caseText: caseData.case,
    questionsJson: JSON.stringify(caseData.questions),
    modelAnswersJson: JSON.stringify(caseData.model_answers),
  });
  return id;
}

export async function getClinicalCase(id: string, userId: string) {
  return db.query.clinicalCase.findFirst({
    where: and(eq(clinicalCase.id, id), eq(clinicalCase.userId, userId)),
  });
}

/**
 * Persist a clinical case evaluation attempt. Each (case, user, attempt)
 * combination is stored once (unique index); attempts are numbered 1..N in
 * evaluation order. Attempts only guard history retention, not XP (XP remains
 * once-ever via the xp_log case_complete unique partial index).
 */
export async function createClinicalCaseEvaluation(params: {
  caseId: string;
  userId: string;
  answers: string[];
  score: number;
  feedback?: string | null;
}) {
  const [prev] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM clinical_case_evaluation
    WHERE case_id = ${params.caseId} AND user_id = ${params.userId}
  `)) as { n?: number }[];
  const attemptNumber = (typeof prev?.n === "number" ? prev.n : 0) + 1;
  await db.insert(clinicalCaseEvaluation).values({
    caseId: params.caseId,
    userId: params.userId,
    attemptNumber,
    answersJson: params.answers,
    score: params.score,
    feedbackJson: params.feedback ? { text: params.feedback } : null,
  });
  return attemptNumber;
}

export async function listMyCases(userId: string, limit = 10) {
  return db.query.clinicalCase.findMany({
    where: eq(clinicalCase.userId, userId),
    orderBy: (c, { desc }) => [desc(c.createdAt)],
    limit,
    with: { lecture: true },
  });
}

export async function getAllClinicalCases(userId: string) {
  return db.query.clinicalCase.findMany({
    where: eq(clinicalCase.userId, userId),
    orderBy: (c, { desc }) => [desc(c.createdAt)],
    with: { lecture: true },
  });
}

export async function getAllFlashcards(userId: string) {
  return db.query.flashcard.findMany({
    where: eq(flashcard.userId, userId),
    orderBy: (f, { desc }) => [desc(f.createdAt)],
    with: { lecture: true },
  });
}
