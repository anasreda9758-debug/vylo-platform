import { db } from "@/shared/db";
import { sql, eq, and, inArray } from "drizzle-orm";
import { buildWeeklyPlan, type PlanLecture, type WeeklyPlan } from "./weeklyPlan";
import { getDueFlashcards } from "@/features/review/queries";

/** Cairo-local date, matching the rest of the platform's scheduling policy. */
export const cairoToday = (now: Date = new Date()): string => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(now);
};

type LectureRow = {
  id: string;
  slug: string;
  title: string;
  completed: boolean;
  moduleSlug: string;
  moduleTitle: string;
};

/**
 * Builds the student's weekly plan from real data.
 *
 * Bounded queries only: one lecture read, one due-count read, one module read.
 * Returns a truthful empty plan (never a blank screen) when there is no work.
 */
export const getWeeklyPlan = async (userId: string, opts: { dailyMinutes?: number } = {}): Promise<WeeklyPlan> => {
  const lectures = (await db.execute(sql`
    select l.id, l.slug, l.title,
           coalesce(lp.completed_at is not null, false) as completed,
           m.slug as "moduleSlug", m.title as "moduleTitle"
    from lectures l
    join modules m on m.id = l.module_id
    left join lecture_progress lp on lp.lecture_id = l.id and lp.user_id = ${userId}
    where m.study_year = (select study_year from users where id = ${userId})
    order by m.position asc, l.position asc
    limit 400
  `)) as unknown as { rows: LectureRow[] };

  const rows = (lectures as unknown as { rows?: LectureRow[] }).rows ?? (lectures as unknown as LectureRow[]);
  const planLectures: PlanLecture[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id), slug: String(r.slug), title: String(r.title),
    moduleSlug: String(r.moduleSlug), moduleTitle: String(r.moduleTitle),
    completed: Boolean(r.completed),
  }));

  let dueFlashcardCount = 0;
  try {
    const due = await getDueFlashcards(userId, 200);
    dueFlashcardCount = Array.isArray(due) ? due.length : 0;
  } catch {
    dueFlashcardCount = 0; // never let an optional signal break the plan
  }

  let practicalModules: Array<{ slug: string; title: string; questionCount: number }> = [];
  try {
    const mods = await db.execute(sql`
      select m.slug, m.title, count(q.id)::int as "questionCount"
      from modules m
      join practical_question q on q.module_id = m.id
      where m.study_year = (select study_year from users where id = ${userId})
      group by m.slug, m.title
      having count(q.id) > 0
      order by count(q.id) desc
      limit 10
    `);
    const mrows = (mods as unknown as { rows?: Array<{ slug: string; title: string; questionCount: number }> }).rows ?? [];
    practicalModules = mrows;
  } catch {
    practicalModules = [];
  }

  return buildWeeklyPlan({
    today: cairoToday(),
    lectures: planLectures,
    dueFlashcardCount,
    quizModules: [],
    practicalModules,
    dailyMinutes: opts.dailyMinutes,
  });
};

void and;
void eq;
void inArray;
