import { and, desc, eq, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import {
  question,
  questionBank,
  questionReview,
  quizAnswer,
  quizAttempt,
} from "./schema";
import { curriculumModule } from "../curriculum/schema";
import { canAccessModule, type LearningActor } from "../access/learning-access";

export type QuizQuestion = {
  id: string;
  prompt: string;
  imageUrl: string | null;
  explanation: string | null;
  difficulty: string;
  order: number;
  options: { id: string; text: string }[];
};

export async function getBankBySlug(slug: string) {
  return db.query.questionBank.findFirst({
    where: eq(questionBank.slug, slug),
    with: { module: true },
  });
}

export async function getBankForModule(moduleId: string) {
  return db.query.questionBank.findFirst({
    where: eq(questionBank.moduleId, moduleId),
  });
}

export async function getBankForLecture(lectureId: string) {
  return db.query.questionBank.findFirst({
    where: eq(questionBank.lectureId, lectureId),
    with: { module: true },
  });
}

export async function getQuizQuestions(bankId: string): Promise<QuizQuestion[]> {
  const rows = await db.query.question.findMany({
    where: eq(question.bankId, bankId),
    orderBy: (q, { asc }) => [asc(q.order)],
    with: { options: { orderBy: (o, { asc }) => [asc(o.order)] } },
  });
  return rows.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    imageUrl: q.imageUrl ?? null,
    explanation: q.explanation ?? null,
    difficulty: q.difficulty ?? "medium",
    order: q.order,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
  }));
}

export async function getQuizQuestionsRandom(
  bankId: string,
  count: number,
  opts?: { difficulty?: string; userId?: string; lectureId?: string },
): Promise<QuizQuestion[]> {
  let rows = await db.query.question.findMany({
    where: eq(question.bankId, bankId),
    with: { options: { orderBy: (o, { asc }) => [asc(o.order)] } },
  });

  // Filter by lecture if specified (only show questions for this lecture)
  if (opts?.lectureId) {
    rows = rows.filter((q) => q.lectureId === opts.lectureId);
  }

  // Filter by difficulty if specified
  if (opts?.difficulty) {
    rows = rows.filter((q) => q.difficulty === opts.difficulty);
  }

  // Spaced-repetition: boost questions due for review
  if (opts?.userId) {
    const dueQuestions = await db
      .select({ questionId: questionReview.questionId })
      .from(questionReview)
      .where(
        and(
          eq(questionReview.userId, opts.userId),
          lte(questionReview.nextReview, new Date()),
        ),
      );

    const dueSet = new Set(dueQuestions.map((d) => d.questionId));
    // Sort: due questions first, then random
    rows.sort((a, b) => {
      const aDue = dueSet.has(a.id) ? 0 : 1;
      const bDue = dueSet.has(b.id) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return Math.random() - 0.5;
    });
  } else {
    rows.sort(() => Math.random() - 0.5);
  }

  const sliced = rows.slice(0, count);
  return sliced.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    imageUrl: q.imageUrl ?? null,
    explanation: q.explanation ?? null,
    difficulty: q.difficulty ?? "medium",
    order: q.order,
    options: q.options.map((o) => ({ id: o.id, text: o.text })).sort(() => Math.random() - 0.5),
  }));
}

export async function getInProgressAttempt(userId: string, bankId: string) {
  return db.query.quizAttempt.findFirst({
    where: and(
      eq(quizAttempt.userId, userId),
      eq(quizAttempt.bankId, bankId),
      eq(quizAttempt.status, "in_progress"),
    ),
  });
}

export async function getOwnedAttempt(userId: string, attemptId: string) {
  return db.query.quizAttempt.findFirst({
    where: and(eq(quizAttempt.id, attemptId), eq(quizAttempt.userId, userId)),
  });
}

export async function createAttempt(
  userId: string,
  bankId: string,
  opts?: { difficulty?: string; timeLimitSec?: number },
) {
  const attempt = await db
    .insert(quizAttempt)
    .values({
      id: randomUUID(),
      userId,
      bankId,
      difficulty: opts?.difficulty ?? null,
      timeLimitSec: opts?.timeLimitSec ?? null,
    })
    .returning();
  return attempt[0];
}

export async function resolveAttempt(userId: string, bankId: string) {
  const existing = await getInProgressAttempt(userId, bankId);
  return existing ?? (await createAttempt(userId, bankId));
}

export async function startAttempt(
  userId: string,
  bankId: string,
  opts?: { difficulty?: string; timeLimitSec?: number },
) {
  await db
    .update(quizAttempt)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(
      and(
        eq(quizAttempt.userId, userId),
        eq(quizAttempt.bankId, bankId),
        eq(quizAttempt.status, "in_progress"),
      ),
    );
  return createAttempt(userId, bankId, opts);
}

export async function gradeAnswer(params: {
  attemptId: string;
  questionId: string;
  optionId: string;
  timeSpentMs?: number;
}) {
  const q = await db.query.question.findFirst({
    where: eq(question.id, params.questionId),
    with: { options: true },
  });
  if (!q) return null;

  const selected = q.options.find((o) => o.id === params.optionId);
  if (!selected) return null;

  const isCorrect = selected.isCorrect;
  const correctOption = q.options.find((o) => o.isCorrect);

  await db
    .insert(quizAnswer)
    .values({
      id: randomUUID(),
      attemptId: params.attemptId,
      questionId: params.questionId,
      optionId: params.optionId,
      isCorrect,
      timeSpentMs: params.timeSpentMs ?? 0,
    })
    .onConflictDoUpdate({
      target: [quizAnswer.attemptId, quizAnswer.questionId],
      set: {
        optionId: params.optionId,
        isCorrect,
        timeSpentMs: params.timeSpentMs ?? 0,
        answeredAt: new Date(),
      },
    });

  return { correct: isCorrect, explanation: q.explanation ?? null, correctOptionId: correctOption?.id ?? null };
}

export async function finishAttempt(userId: string, attemptId: string) {
  const attempt = await getOwnedAttempt(userId, attemptId);
  if (!attempt) return null;
  if (attempt.status === "completed") {
    return {
      score: attempt.score,
      total: attempt.total,
      percent: attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0,
    };
  }

  const answers = await db
    .select({ isCorrect: quizAnswer.isCorrect, questionId: quizAnswer.questionId, timeSpentMs: quizAnswer.timeSpentMs })
    .from(quizAnswer)
    .where(eq(quizAnswer.attemptId, attemptId));
  const score = answers.filter((a) => a.isCorrect).length;
  const questionCount = answers.length;

  await db
    .update(quizAttempt)
    .set({ score, total: questionCount, status: "completed", completedAt: new Date() })
    .where(eq(quizAttempt.id, attemptId));

  // Update spaced-repetition for each answered question
  for (const ans of answers) {
    await updateQuestionReview(userId, ans.questionId, ans.isCorrect, ans.timeSpentMs);
  }

  return {
    score,
    total: questionCount,
    percent: questionCount ? Math.round((score / questionCount) * 100) : 0,
  };
}

// ── Spaced Repetition (SM-2 Algorithm) ──

/**
 * SM-2 quality: 0-5
 * We map correct/incorrect to SM-2 quality:
 *   correct + fast (<5s)  → quality 5
 *   correct + normal      → quality 4
 *   correct + slow (>15s) → quality 3
 *   incorrect + close     → quality 1
 *   incorrect              → quality 0
 */
function correctToQuality(isCorrect: boolean, timeMs: number): number {
  if (!isCorrect) return 0;
  const sec = timeMs / 1000;
  if (sec < 5) return 5;  // correct + fast
  if (sec < 15) return 4; // correct + normal
  return 3;                // correct + slow
}

export async function updateQuestionReview(userId: string, questionId: string, isCorrect: boolean, timeMs: number) {
  const quality = correctToQuality(isCorrect, timeMs);

  const [existing] = await db
    .select()
    .from(questionReview)
    .where(
      and(
        eq(questionReview.userId, userId),
        eq(questionReview.questionId, questionId),
      ),
    )
    .limit(1);

  if (!existing) {
    // First review
    const interval = quality >= 3 ? 1 : 0;
    const ef = Math.max(130, 250 + (quality - 3) * 10); // min 1.3
    const nextReview = new Date();
    if (interval > 0) nextReview.setDate(nextReview.getDate() + interval);

    await db.insert(questionReview).values({
      id: randomUUID(),
      userId,
      questionId,
      easeFactor: ef,
      interval,
      repetitions: quality >= 3 ? 1 : 0,
      nextReview,
      lastReview: new Date(),
      totalReviews: 1,
      correctCount: isCorrect ? 1 : 0,
    });
    return;
  }

  // SM-2 algorithm
  let ef = existing.easeFactor;
  let interval = existing.interval;
  let reps = existing.repetitions;

  if (quality >= 3) {
    // Correct
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * (ef / 100));
    }
    reps += 1;
  } else {
    // Incorrect — reset
    reps = 0;
    interval = 0;
  }

  // Update ease factor
  ef = ef + (quality - 3) * 10;
  ef = Math.max(130, ef); // minimum 1.3

  const nextReview = new Date();
  if (interval > 0) {
    nextReview.setDate(nextReview.getDate() + interval);
  } else {
    // Review again soon (10 minutes)
    nextReview.setMinutes(nextReview.getMinutes() + 10);
  }

  await db
    .update(questionReview)
    .set({
      easeFactor: ef,
      interval,
      repetitions: reps,
      nextReview,
      lastReview: new Date(),
      totalReviews: existing.totalReviews + 1,
      correctCount: existing.correctCount + (isCorrect ? 1 : 0),
      updatedAt: new Date(),
    })
    .where(eq(questionReview.id, existing.id));
}

// ── Quiz History ──

type ModuleScopedRow = {
  moduleId: string;
  moduleSlug: string;
  moduleIsFree: boolean;
  moduleTerm: number;
};

/**
 * Results remain private to their owner, but are also filtered by the current
 * module entitlement so an expired subscription cannot disclose paid results.
 */
async function filterAccessibleModuleRows<T extends ModuleScopedRow>(
  actor: LearningActor,
  rows: T[],
): Promise<T[]> {
  const decisions = new Map<string, boolean>();
  for (const row of rows) {
    if (decisions.has(row.moduleId)) continue;
    const access = await canAccessModule(actor, {
      id: row.moduleId,
      slug: row.moduleSlug,
      isFree: row.moduleIsFree,
      term: row.moduleTerm,
    });
    decisions.set(row.moduleId, access.ok);
  }
  return rows.filter((row) => decisions.get(row.moduleId) === true);
}

export async function getQuizHistory(actor: LearningActor, limit = 20) {
  const rows = await db
    .select({
      id: quizAttempt.id,
      bankId: quizAttempt.bankId,
      score: quizAttempt.score,
      total: quizAttempt.total,
      status: quizAttempt.status,
      difficulty: quizAttempt.difficulty,
      timeLimitSec: quizAttempt.timeLimitSec,
      elapsedSec: quizAttempt.elapsedSec,
      startedAt: quizAttempt.startedAt,
      completedAt: quizAttempt.completedAt,
      bankTitle: questionBank.title,
      bankSlug: questionBank.slug,
      moduleId: curriculumModule.id,
      moduleName: curriculumModule.name,
      moduleSlug: curriculumModule.slug,
      moduleIsFree: curriculumModule.isFree,
      moduleTerm: curriculumModule.term,
    })
    .from(quizAttempt)
    .innerJoin(questionBank, eq(quizAttempt.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(and(eq(quizAttempt.userId, actor.id), eq(quizAttempt.status, "completed")))
    .orderBy(desc(quizAttempt.completedAt))
    .limit(limit);

  const accessibleRows = await filterAccessibleModuleRows(actor, rows);
  return accessibleRows.map((r) => ({
    id: r.id,
    bankTitle: r.bankTitle,
    bankSlug: r.bankSlug,
    moduleName: r.moduleName,
    moduleSlug: r.moduleSlug,
    score: r.score,
    total: r.total,
    percent: r.total ? Math.round((r.score / r.total) * 100) : 0,
    difficulty: r.difficulty,
    timeLimitSec: r.timeLimitSec,
    elapsedSec: r.elapsedSec,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  }));
}

export async function getModuleAccuracy(actor: LearningActor, studyYear?: number) {
  const rows = await db
    .select({
      moduleId: curriculumModule.id,
      moduleSlug: curriculumModule.slug,
      moduleName: curriculumModule.name,
      studyYear: curriculumModule.studyYear,
      moduleIsFree: curriculumModule.isFree,
      moduleTerm: curriculumModule.term,
      score: quizAttempt.score,
      total: quizAttempt.total,
    })
    .from(quizAttempt)
    .innerJoin(questionBank, eq(quizAttempt.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(and(eq(quizAttempt.userId, actor.id), eq(quizAttempt.status, "completed")))
    .orderBy(desc(quizAttempt.completedAt));

  const accessibleRows = await filterAccessibleModuleRows(actor, rows);
  const byModule = new Map<string, { moduleSlug: string; moduleName: string; score: number; total: number }>();
  for (const r of accessibleRows) {
    const cur = byModule.get(r.moduleSlug) ?? {
      moduleSlug: r.moduleSlug,
      moduleName: r.moduleName,
      score: 0,
      total: 0,
    };
    cur.score += r.score;
    cur.total += r.total;
    byModule.set(r.moduleSlug, cur);
  }

  return [...byModule.values()]
    .filter((m) => studyYear === undefined || (accessibleRows.find((row) => row.moduleSlug === m.moduleSlug)?.studyYear === studyYear))
    .map((m) => ({
    moduleSlug: m.moduleSlug,
    moduleName: m.moduleName,
    correct: m.score,
    total: m.total,
    percent: m.total ? Math.round((m.score / m.total) * 100) : 0,
  }));
}

// ── Analytics ──

export async function getQuizAnalytics(actor: LearningActor) {
  // All completed attempts
  const attempts = await db
    .select({
      id: quizAttempt.id,
      score: quizAttempt.score,
      total: quizAttempt.total,
      difficulty: quizAttempt.difficulty,
      elapsedSec: quizAttempt.elapsedSec,
      startedAt: quizAttempt.startedAt,
      completedAt: quizAttempt.completedAt,
      bankTitle: questionBank.title,
      bankSlug: questionBank.slug,
      moduleId: curriculumModule.id,
      moduleName: curriculumModule.name,
      moduleSlug: curriculumModule.slug,
      moduleIsFree: curriculumModule.isFree,
      moduleTerm: curriculumModule.term,
    })
    .from(quizAttempt)
    .innerJoin(questionBank, eq(quizAttempt.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(and(eq(quizAttempt.userId, actor.id), eq(quizAttempt.status, "completed")))
    .orderBy(desc(quizAttempt.completedAt));

  // All answers with timing
  const allAnswers = await db
    .select({
      isCorrect: quizAnswer.isCorrect,
      timeSpentMs: quizAnswer.timeSpentMs,
      difficulty: question.difficulty,
      bankSlug: questionBank.slug,
      moduleId: curriculumModule.id,
      moduleName: curriculumModule.name,
      moduleSlug: curriculumModule.slug,
      moduleIsFree: curriculumModule.isFree,
      moduleTerm: curriculumModule.term,
    })
    .from(quizAnswer)
    .innerJoin(quizAttempt, eq(quizAnswer.attemptId, quizAttempt.id))
    .innerJoin(question, eq(quizAnswer.questionId, question.id))
    .innerJoin(questionBank, eq(question.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(eq(quizAttempt.userId, actor.id));

  const accessibleAttempts = await filterAccessibleModuleRows(actor, attempts);
  const accessibleAnswers = await filterAccessibleModuleRows(actor, allAnswers);

  // Accuracy over time (group by date)
  const byDate = new Map<string, { correct: number; total: number }>();
  for (const a of accessibleAttempts) {
    const date = (a.completedAt ?? a.startedAt).toISOString().slice(0, 10);
    const cur = byDate.get(date) ?? { correct: 0, total: 0 };
    cur.correct += a.score;
    cur.total += a.total;
    byDate.set(date, cur);
  }
  const accuracyOverTime = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14) // last 14 days
    .map(([date, d]) => ({
      date,
      percent: d.total ? Math.round((d.correct / d.total) * 100) : 0,
      correct: d.correct,
      total: d.total,
    }));

  // Per-module accuracy
  const moduleMap = new Map<string, { name: string; correct: number; total: number; avgTimeMs: number; count: number }>();
  for (const a of accessibleAnswers) {
    const key = a.moduleSlug;
    const cur = moduleMap.get(key) ?? { name: a.moduleName, correct: 0, total: 0, avgTimeMs: 0, count: 0 };
    cur.total++;
    if (a.isCorrect) cur.correct++;
    cur.avgTimeMs += a.timeSpentMs;
    cur.count++;
    moduleMap.set(key, cur);
  }
  const perModule = [...moduleMap.entries()].map(([slug, m]) => ({
    moduleSlug: slug,
    moduleName: m.name,
    correct: m.correct,
    total: m.total,
    percent: m.total ? Math.round((m.correct / m.total) * 100) : 0,
    avgTimeMs: m.count ? Math.round(m.avgTimeMs / m.count) : 0,
  }));

  // Difficulty breakdown
  const diffMap = new Map<string, { correct: number; total: number }>();
  for (const a of accessibleAnswers) {
    const d = a.difficulty ?? "medium";
    const cur = diffMap.get(d) ?? { correct: 0, total: 0 };
    cur.total++;
    if (a.isCorrect) cur.correct++;
    diffMap.set(d, cur);
  }
  const byDifficulty = [...diffMap.entries()].map(([diff, d]) => ({
    difficulty: diff,
    correct: d.correct,
    total: d.total,
    percent: d.total ? Math.round((d.correct / d.total) * 100) : 0,
  }));

  // Timing distribution (avg ms per question by difficulty)
  const timingByDiff = new Map<string, { sum: number; count: number }>();
  for (const a of accessibleAnswers) {
    const d = a.difficulty ?? "medium";
    const cur = timingByDiff.get(d) ?? { sum: 0, count: 0 };
    cur.sum += a.timeSpentMs;
    cur.count++;
    timingByDiff.set(d, cur);
  }
  const avgTimeByDifficulty = [...timingByDiff.entries()].map(([diff, t]) => ({
    difficulty: diff,
    avgMs: t.count ? Math.round(t.sum / t.count) : 0,
    avgSec: t.count ? Math.round(t.sum / t.count / 1000) : 0,
  }));

  // Overall stats
  const totalAttempts = accessibleAttempts.length;
  const totalAnswered = accessibleAnswers.length;
  const totalCorrect = accessibleAnswers.filter((a) => a.isCorrect).length;
  const avgPercent = totalAttempts > 0
    ? Math.round(accessibleAttempts.reduce((s, a) => s + (a.total ? (a.score / a.total) * 100 : 0), 0) / totalAttempts)
    : 0;
  const bestPercent = accessibleAttempts.length > 0
    ? Math.max(...accessibleAttempts.map((a) => (a.total ? Math.round((a.score / a.total) * 100) : 0)))
    : 0;
  const avgTimePerQuestion = totalAnswered > 0
    ? Math.round(accessibleAnswers.reduce((s, a) => s + a.timeSpentMs, 0) / totalAnswered / 1000)
    : 0;

  return {
    overall: { totalAttempts, totalAnswered, totalCorrect, avgPercent, bestPercent, avgTimePerQuestion },
    accuracyOverTime,
    perModule,
    byDifficulty,
    avgTimeByDifficulty,
  };
}

export async function getDueReviewCount(actor: LearningActor, moduleIds?: string[]) {
  const rows = await db
    .select({
      moduleId: curriculumModule.id,
      moduleSlug: curriculumModule.slug,
      moduleIsFree: curriculumModule.isFree,
      moduleTerm: curriculumModule.term,
    })
    .from(questionReview)
    .innerJoin(question, eq(questionReview.questionId, question.id))
    .innerJoin(questionBank, eq(question.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(and(eq(questionReview.userId, actor.id), lte(questionReview.nextReview, new Date())));
  const scoped = moduleIds ? rows.filter((row) => moduleIds.includes(row.moduleId)) : rows;
  return (await filterAccessibleModuleRows(actor, scoped)).length;
}
