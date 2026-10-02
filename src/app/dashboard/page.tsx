import { requireUser } from "@/shared/session";
import { getCurriculum, getStudyYears } from "@/features/curriculum/queries";
import { getModuleAccuracy, getDueReviewCount } from "@/features/practice/queries";
import { getActiveSubscriptions } from "@/features/billing/queries";
import { getProfile } from "@/features/gamification/queries";
import { db } from "@/shared/db";
import { quizAttempt, questionBank } from "@/features/practice/schema";
import { curriculumModule } from "@/features/curriculum/schema";
import { and, eq, desc } from "drizzle-orm";
import { Navigation } from "@/components/navigation";
import { getLocale } from "@/shared/locale";
import { getSelectedStudyYear } from "@/shared/study-year";
import { canAccessModule } from "@/features/access/learning-access";
import { DashboardHome } from "@/components/dashboard-home";

export default async function DashboardPage() {
  const session = await requireUser();
  const locale = await getLocale();
  const user = session.user;
  const studyYears = await getStudyYears();
  const availableYears = studyYears.length ? studyYears : [1];
  const savedYear = await getSelectedStudyYear();
  const studyYear = availableYears.includes(savedYear) ? savedYear : availableYears[0];
  const curriculum = await getCurriculum(user.id, studyYear);
  const accessibleCurriculum = await Promise.all(
    curriculum.map(async (module) => ({
      ...module,
      access: (await canAccessModule(user, module)).ok,
    })),
  );
  const accuracy = await getModuleAccuracy(user, studyYear);
  const subs = (await getActiveSubscriptions(user.id)).filter(
    (s) => s.expiresAt > new Date()
  );
  const profile = await getProfile(user.id);
  const dueReviewCount = await getDueReviewCount(user);
  const nextLecture = accessibleCurriculum
    .flatMap((module) => module.lectures.map((lecture) => ({ ...lecture, moduleName: module.name, accessible: module.access })))
    .find((lecture) => lecture.accessible && !lecture.completed) ?? null;
  const weakModule = [...accuracy]
    .filter((module) => module.total > 0)
    .sort((a, b) => a.percent - b.percent)[0] ?? null;

  const totalCorrect = accuracy.reduce((s, m) => s + m.correct, 0);
  const totalAnswered = accuracy.reduce((s, m) => s + m.total, 0);
  const avgAccuracy =
    totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  // Total lectures
  const totalLectures = curriculum.reduce((s, m) => s + m.totalLectures, 0);
  const completedLectures = curriculum.reduce((s, m) => s + m.completedLectures, 0);
  const overallPercent = totalLectures > 0 ? Math.round((completedLectures / totalLectures) * 100) : 0;
  const examReadiness = Math.round(
    overallPercent * 0.45 + (totalAnswered > 0 ? avgAccuracy : 0) * 0.45 + Math.min(totalAnswered / 100, 1) * 10,
  );

  // Keep term details scoped to the selected year, using the loaded curriculum.
  const termProgress = [...new Set(curriculum.map((module) => module.term))]
    .sort((a, b) => a - b)
    .map((term) => {
      const modules = accessibleCurriculum.filter((module) => module.term === term);
      const totalLectures = modules.reduce((sum, module) => sum + module.totalLectures, 0);
      const accessible = modules.filter((module) => module.access);
      const accessibleTotal = accessible.reduce((sum, module) => sum + module.totalLectures, 0);
      const completedLectures = accessible.reduce((sum, module) => sum + module.completedLectures, 0);
      return {
        term, totalLectures, completedLectures, hasContent: totalLectures > 0,
        percent: accessibleTotal ? Math.round(completedLectures / accessibleTotal * 100) : 0,
      };
    });

  // Recent quizzes (last 5)
  const recentQuizzes = await db
    .select({
      id: quizAttempt.id,
      score: quizAttempt.score,
      total: quizAttempt.total,
      completedAt: quizAttempt.completedAt,
      bankTitle: questionBank.title,
      moduleName: curriculumModule.name,
    })
    .from(quizAttempt)
    .innerJoin(questionBank, eq(quizAttempt.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(and(eq(quizAttempt.userId, user.id), eq(quizAttempt.status, "completed")))
    .orderBy(desc(quizAttempt.completedAt))
    .limit(5);

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation user={{ name: user.name, email: user.email }} isAdmin={user.role === "admin"} />
      <DashboardHome
        name={user.name} locale={locale} years={availableYears} year={studyYear}
        nextLecture={nextLecture} modules={accessibleCurriculum}
        due={dueReviewCount} completed={completedLectures} total={totalLectures}
        percent={overallPercent} accuracy={totalAnswered > 0 ? avgAccuracy : null}
        score={examReadiness} level={profile.level} xp={profile.totalXp}
        weakModule={weakModule} recent={recentQuizzes}
        terms={termProgress} subscriptions={subs}
      />
    </div>
  );
}
