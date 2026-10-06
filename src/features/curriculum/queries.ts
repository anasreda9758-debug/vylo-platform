import { asc, eq, and } from "drizzle-orm";
import { db } from "@/shared/db";
import { isHiddenFromStudentCurriculum } from "@/shared/curriculum-copy";
import { curriculumModule, lecture, lectureProgress } from "./schema";

export async function getLectureBySlug(slug: string) {
  return db.query.lecture.findFirst({
    where: eq(lecture.slug, slug),
    with: { module: true },
  });
}

export async function getStudyYears() {
  const rows = await db
    .select({ studyYear: curriculumModule.studyYear })
    .from(curriculumModule)
    .groupBy(curriculumModule.studyYear)
    .orderBy(asc(curriculumModule.studyYear));
  return rows.map((row) => row.studyYear);
}

export async function getCurriculum(userId: string, studyYear?: number) {
  const modules = (
    await db.query.curriculumModule.findMany({
      where: studyYear ? eq(curriculumModule.studyYear, studyYear) : undefined,
      orderBy: (m, { asc }) => [asc(m.order)],
      with: {
        lectures: {
          orderBy: (l, { asc }) => [asc(l.order)],
        },
      },
    })
  ).filter((m) => !isHiddenFromStudentCurriculum(m.slug));

  const done = await db
    .select({ lectureId: lectureProgress.lectureId })
    .from(lectureProgress)
    .where(eq(lectureProgress.userId, userId));
  const doneSet = new Set(done.map((r) => r.lectureId));

  return modules.map((m) => {
    const total = m.lectures.length;
    const completed = m.lectures.filter((l) => doneSet.has(l.id)).length;
    return {
      ...m,
      totalLectures: total,
      completedLectures: completed,
      percent: total ? Math.round((completed / total) * 100) : 0,
      lectures: m.lectures.map((l) => ({ ...l, completed: doneSet.has(l.id) })),
    };
  });
}

export async function getModuleBySlug(userId: string, slug: string) {
  const curriculum = await getCurriculum(userId);
  return curriculum.find((m) => m.slug === slug) ?? null;
}

export async function getOverallProgress(userId: string, studyYear?: number) {
  const curriculum = await getCurriculum(userId, studyYear);
  const { withModuleAccess } = await import("@/features/billing/queries");
  const accessible = (await withModuleAccess(userId, curriculum)).filter((m) => m.access);
  const total = accessible.reduce((sum, m) => sum + m.totalLectures, 0);
  const completed = accessible.reduce((sum, m) => sum + m.completedLectures, 0);
  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

export interface TermProgress {
  term: number;
  studyYear: number;
  moduleCount: number;
  totalLectures: number;
  completedLectures: number;
  percent: number;
  hasContent: boolean;
  accessibleModuleCount: number;
}

export async function getTermProgress(
  userId: string,
  term: number,
  studyYear?: number
): Promise<TermProgress> {
  // Fetch completions internally for standalone use
  const done = await db
    .select({ lectureId: lectureProgress.lectureId })
    .from(lectureProgress)
    .where(eq(lectureProgress.userId, userId));
  const doneSet = new Set(done.map((r) => r.lectureId));
  return getTermProgressWithDoneSet(userId, term, doneSet, studyYear);
}

export async function getTermProgressWithDoneSet(
  userId: string,
  term: number,
  doneSet: Set<string>,
  studyYear?: number
): Promise<TermProgress> {
  // Get all modules for the term (respecting studyYear filter if provided)
  const modules = (
    await db.query.curriculumModule.findMany({
      where: and(
        eq(curriculumModule.term, term),
        studyYear ? eq(curriculumModule.studyYear, studyYear) : undefined
      ),
      orderBy: (m, { asc }) => [asc(m.order)],
      with: {
        lectures: {
          orderBy: (l, { asc }) => [asc(l.order)],
        },
      },
    })
  ).filter((m) => !isHiddenFromStudentCurriculum(m.slug));

  if (modules.length === 0) {
    return {
      term,
      studyYear: studyYear ?? 0,
      moduleCount: 0,
      totalLectures: 0,
      completedLectures: 0,
      percent: 0,
      hasContent: false,
      accessibleModuleCount: 0,
    };
  }

  const totalLectures = modules.reduce((sum, m) => sum + m.lectures.length, 0);

  const completedLectures = modules.reduce(
    (sum, m) => sum + m.lectures.filter((l) => doneSet.has(l.id)).length,
    0
  );

  // Check entitlement for modules
  const { withModuleAccess } = await import("@/features/billing/queries");
  const accessible = (await withModuleAccess(userId, modules)).filter((m) => m.access);
  const accessibleModuleCount = accessible.length;

  // Only count completed lectures from accessible modules for percent
  const accessibleCompletedLectures = accessible.reduce(
    (sum, m) => sum + m.lectures.filter((l) => doneSet.has(l.id)).length,
    0
  );
  const accessibleTotalLectures = accessible.reduce((sum, m) => sum + m.lectures.length, 0);

  const percent =
    accessibleTotalLectures > 0
      ? Math.round((accessibleCompletedLectures / accessibleTotalLectures) * 100)
      : 0;

  return {
    term,
    studyYear: studyYear ?? 0,
    moduleCount: modules.length,
    totalLectures,
    completedLectures: accessibleCompletedLectures,
    percent,
    hasContent: totalLectures > 0,
    accessibleModuleCount,
  };
}

export async function getAllTermProgress(
  userId: string
): Promise<TermProgress[]> {
  const maxTerm = 10;
  const terms = Array.from({ length: maxTerm }, (_, i) => i + 1);

  // Fetch completions ONCE and reuse across all 10 terms
  const done = await db
    .select({ lectureId: lectureProgress.lectureId })
    .from(lectureProgress)
    .where(eq(lectureProgress.userId, userId));
  const doneSet = new Set(done.map((r) => r.lectureId));

  // For the all-terms dashboard view, do NOT filter by studyYear.
  // Each term should be queried without a studyYear filter to show all modules
  // belonging to that term number across all study years.
  return Promise.all(terms.map((term) => getTermProgressWithDoneSet(userId, term, doneSet)));
}
