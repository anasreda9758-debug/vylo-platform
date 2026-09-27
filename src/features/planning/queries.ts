import { getCurriculum } from "@/features/curriculum/queries";
import { getDueFlashcards } from "@/features/review/queries";
import { db } from "@/shared/db";
import { eq, and, count } from "drizzle-orm";
import { curriculumModule } from "@/features/curriculum/schema";
import { practicalQuestion } from "@/features/practical/schema";
import { questionBank } from "@/features/practice/schema";
import { buildWeeklyPlan, type PlanLecture, type WeeklyPlan } from "./weeklyPlan";

/** Cairo-local date, matching the rest of the platform's scheduling policy. */
export const cairoToday = (now: Date = new Date()): string => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(now);
};

/**
 * Builds the student's weekly plan from real data.
 *
 * Uses the existing typed curriculum query rather than hand-written SQL, so the
 * hidden-from-student module filter and progress semantics stay in exactly one
 * place. Every optional signal is individually guarded: a failure in one must
 * never blank the whole plan.
 */
export const getWeeklyPlan = async (
  userId: string,
  opts: { dailyMinutes?: number; studyYear?: number } = {},
): Promise<WeeklyPlan> => {
  const lectures: PlanLecture[] = [];
  try {
    const modules = await getCurriculum(userId, opts.studyYear);
    for (const m of modules) {
      for (const l of m.lectures) {
        lectures.push({
          id: l.id,
          slug: l.slug,
          title: l.title,
          moduleSlug: m.slug,
          moduleTitle: m.name,
          completed: Boolean(l.completed),
        });
      }
    }
  } catch {
    // Curriculum unreadable: return an honest empty plan rather than throwing.
    return buildWeeklyPlan({
      today: cairoToday(), lectures: [], dueFlashcardCount: 0,
      quizModules: [], practicalModules: [], dailyMinutes: opts.dailyMinutes,
    });
  }

  let dueFlashcardCount = 0;
  try {
    const due = await getDueFlashcards(userId, 200);
    dueFlashcardCount = Array.isArray(due) ? due.length : 0;
  } catch {
    dueFlashcardCount = 0;
  }

  let practicalModules: Array<{ slug: string; title: string; questionCount: number }> = [];
  try {
    const rows = await db
      .select({ slug: curriculumModule.slug, title: curriculumModule.name, n: count(practicalQuestion.id) })
      .from(practicalQuestion)
      .innerJoin(curriculumModule, eq(practicalQuestion.moduleId, curriculumModule.id))
      .groupBy(curriculumModule.slug, curriculumModule.name)
      .orderBy(count(practicalQuestion.id))
      .limit(10);
    practicalModules = rows
      .map((r) => ({ slug: r.slug, title: r.title, questionCount: Number(r.n) }))
      .filter((r) => r.questionCount > 0);
  } catch {
    practicalModules = [];
  }

  let quizModules: Array<{ slug: string; title: string; hasQuiz: boolean }> = [];
  try {
    const rows = await db
      .select({ slug: curriculumModule.slug, title: curriculumModule.name, n: count(questionBank.id) })
      .from(questionBank)
      .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
      .groupBy(curriculumModule.slug, curriculumModule.name)
      .orderBy(count(questionBank.id))
      .limit(10);
    quizModules = rows
      .map((r) => ({ slug: r.slug, title: r.title, hasQuiz: Number(r.n) > 0 }))
      .filter((r) => r.hasQuiz);
  } catch {
    quizModules = [];
  }

  return buildWeeklyPlan({
    today: cairoToday(),
    lectures,
    dueFlashcardCount,
    quizModules,
    practicalModules,
    dailyMinutes: opts.dailyMinutes,
  });
};

void and;
