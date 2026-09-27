import Link from "next/link";
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
import { getLocale, localize } from "@/shared/locale";
import { getSelectedStudyYear } from "@/shared/study-year";
import { AcademicYearSelector } from "@/components/academic-year-selector";
import { DailyStudyPlan } from "@/components/daily-study-plan";
import { canAccessModule } from "@/features/access/learning-access";
import {
  BookOpen,
  FlaskConical,
  Brain,
  Stethoscope,
  Trophy,
  CreditCard,
  Target,
  Zap,
  Swords,
  RefreshCw,
  Clock,
  TrendingUp,
  ChevronLeft,
} from "lucide-react";
import WeeklyPlanCard from "@/components/weekly-plan-card";

export default async function DashboardPage() {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
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

  // Module progress breakdown
  const moduleProgress = curriculum.map((m) => ({
    name: m.name,
    slug: m.slug,
    completed: m.completedLectures,
    total: m.totalLectures,
    percent: m.percent,
    term: m.term,
  }));

  // Total lectures
  const totalLectures = curriculum.reduce((s, m) => s + m.totalLectures, 0);
  const completedLectures = curriculum.reduce((s, m) => s + m.completedLectures, 0);
  const overallPercent = totalLectures > 0 ? Math.round((completedLectures / totalLectures) * 100) : 0;
  const examReadiness = Math.round(
    overallPercent * 0.45 + (totalAnswered > 0 ? avgAccuracy : 0) * 0.45 + Math.min(totalAnswered / 100, 1) * 10,
  );

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

  // Term 1 vs Term 2
  const term1 = moduleProgress.filter((m) => m.term === 1);
  const term2 = moduleProgress.filter((m) => m.term === 2);
  const term1Percent = term1.length > 0 ? Math.round(term1.reduce((s, m) => s + m.completed, 0) / term1.reduce((s, m) => s + m.total, 0) * 100) : 0;
  const term2Percent = term2.length > 0 ? Math.round(term2.reduce((s, m) => s + m.completed, 0) / term2.reduce((s, m) => s + m.total, 0) * 100) : 0;

  return (
    <div className="flex flex-1">
      <Navigation user={{ name: user.name, email: user.email }} isAdmin={user.role === "admin"} />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{t(`Welcome back, ${user.name}`, `مرحبًا ${user.name}`)}</h1>
              <p className="mt-1 text-muted-foreground">{user.email}</p>
            </div>
            <AcademicYearSelector years={availableYears} value={studyYear} />
          </div>

          <DailyStudyPlan
            nextLecture={nextLecture ? { title: nextLecture.title, slug: nextLecture.slug, moduleName: nextLecture.moduleName, durationMin: nextLecture.durationMin } : null}
            dueReviewCount={dueReviewCount}
            weakModule={weakModule ? { name: weakModule.moduleName, slug: weakModule.moduleSlug } : null}
          />

          {/* Hero Stats Row */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Progress Ring */}
            <div className="rounded-2xl border border-border bg-card p-5 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-4">
                <ProgressRing percent={overallPercent} size={72} strokeWidth={6} />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t("Overall progress", "التقدم الكلي")}</p>
                  <p className="text-2xl font-bold">{overallPercent}%</p>
                  <p className="text-xs text-muted-foreground">{t(`${completedLectures}/${totalLectures} lectures`, `${completedLectures}/${totalLectures} محاضرة`)}</p>
                </div>
              </div>
            </div>

            <StatCard
              icon={Zap}
              label={t("Level", "المستوى")}
              value={`Lv.${profile.level}`}
              sub={`${profile.totalXp} XP`}
              color="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40"
            />
            <StatCard
              icon={Target}
              label={t("Quiz accuracy", "دقة الاختبارات")}
              value={totalAnswered > 0 ? `${avgAccuracy}%` : "—"}
              sub={totalAnswered > 0 ? t(`${totalCorrect}/${totalAnswered} correct`, `${totalCorrect}/${totalAnswered} صحيحة`) : t("Not started", "لم تبدأ بعد")}
              color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
            />
            <StatCard
              icon={RefreshCw}
              label={t("Due review", "مراجعة معلقة")}
              value={String(dueReviewCount)}
              sub={dueReviewCount > 0 ? t("Questions waiting for review", "أسئلة بانتظار المراجعة") : t("No reviews due", "لا توجد مراجعات")}
              color="text-purple-600 bg-purple-50 dark:bg-purple-950/40"
              href="/review"
            />
            <StatCard
              icon={TrendingUp}
              label={t("Exam readiness", "الاستعداد للامتحان")}
              value={`${examReadiness}%`}
              sub={t("Progress + accuracy + practice", "التقدم + الدقة + التدريب")}
              color="text-blue-600 bg-blue-50 dark:bg-blue-950/40"
              href="/quiz/analytics"
            />
          </div>

          {/* Weekly study plan */}
          <div className="mb-8">
            <WeeklyPlanCard />
          </div>

          {/* Quick Actions */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">{t("Quick access", "روابط سريعة")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <QuickAction href="/curriculum" icon={BookOpen} label={t("Browse curriculum", "تصفح المنهج")} />
              <QuickAction href="/review" icon={RefreshCw} label={t("Question review", "مراجعة الأسئلة")} badge={dueReviewCount > 0 ? String(dueReviewCount) : undefined} />
              <QuickAction href="/flashcards" icon={Brain} label={t("Flashcards", "البطاقات التعليمية")} />
              <QuickAction href="/cases" icon={Stethoscope} label={t("Clinical cases", "الحالات السريرية")} />
              <QuickAction href="/ospe" icon={FlaskConical} label={t("OSPE simulator", "محاكي OSPE")} />
              <QuickAction href="/battles" icon={Swords} label={t("Peer challenge", "تحدي الأقران")} />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Module Progress Breakdown */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{t("Curriculum progress", "تقدم المنهج")}</h2>
                <Link href="/curriculum" className="flex items-center gap-1 text-xs text-primary hover:underline">
                  {t("View all", "عرض الكل")} <ChevronLeft className="h-3 w-3" />
                </Link>
              </div>

              {/* Term breakdown */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("Term 1", "الترم الأول")}</p>
                  <ProgressRing percent={term1Percent} size={48} strokeWidth={4} />
                  <p className="mt-1 text-sm font-bold">{term1Percent}%</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("Term 2", "الترم الثاني")}</p>
                  <ProgressRing percent={term2Percent} size={48} strokeWidth={4} />
                  <p className="mt-1 text-sm font-bold">{term2Percent}%</p>
                </div>
              </div>

              {/* Per-module bars */}
              <ul className="space-y-3">
                {moduleProgress.map((m) => (
                  <li key={m.slug}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground">
                        {m.completed}/{m.total} ({m.percent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${
                          m.percent >= 80 ? "bg-emerald-500" :
                          m.percent >= 40 ? "bg-amber-500" :
                          m.percent > 0 ? "bg-blue-500" : "bg-muted-foreground/20"
                        }`}
                        style={{ width: `${m.percent}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Recent Quizzes */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{t("Recent quizzes", "آخر الاختبارات")}</h2>
                <Link href="/quiz/history" className="flex items-center gap-1 text-xs text-primary hover:underline">
                  {t("View all", "عرض الكل")} <ChevronLeft className="h-3 w-3" />
                </Link>
              </div>
              {recentQuizzes.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p>{t("No quizzes completed yet.", "لم تقم بأي اختبار بعد.")}</p>
                  <Link href="/curriculum" className="mt-2 inline-block text-primary hover:underline">{t("Get started", "ابدأ الآن")}</Link>
                </div>
              ) : (
                <ul className="space-y-2">
                  {recentQuizzes.map((q) => {
                    const percent = q.total > 0 ? Math.round((q.score / q.total) * 100) : 0;
                    return (
                      <li key={q.id} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                          percent >= 80 ? "bg-emerald-500/10 text-emerald-600" :
                          percent >= 50 ? "bg-amber-500/10 text-amber-600" :
                          "bg-red-500/10 text-red-600"
                        }`}>
                          {percent}%
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <p className="truncate text-sm font-medium">{q.bankTitle}</p>
                          <p className="text-xs text-muted-foreground">
                            {q.moduleName} · {q.score}/{q.total}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {q.completedAt ? new Date(q.completedAt).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", { month: "short", day: "numeric" }) : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Quiz Accuracy by Module */}
          {accuracy.length > 0 && (
            <div className="mt-6 rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{t("Accuracy by module", "الدقة حسب الموديول")}</h2>
                <Link href="/quiz/analytics" className="flex items-center gap-1 text-xs text-primary hover:underline">
                  {t("Detailed analytics", "تحليلات مفصلة")} <ChevronLeft className="h-3 w-3" />
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {accuracy.map((m) => (
                  <div key={m.moduleSlug} className="rounded-xl bg-muted/50 p-3">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{m.moduleName}</span>
                      <span className={`text-xs font-medium ${
                        m.percent >= 80 ? "text-emerald-600" :
                        m.percent >= 50 ? "text-amber-600" :
                        "text-red-600"
                      }`}>
                        {m.percent}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${
                          m.percent >= 80 ? "bg-emerald-500" :
                          m.percent >= 50 ? "bg-amber-500" :
                          "bg-red-500"
                        }`}
                        style={{ width: `${m.percent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{t(`${m.correct}/${m.total} correct`, `${m.correct}/${m.total} صحيحة`)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subscription Status */}
          {subs.length > 0 && (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-emerald-600">{t("Your subscription is active", "اشتراكك نشط")}</p>
                  <p className="text-xs text-muted-foreground">
                    {subs.length === 1
                      ? t(`Ends ${subs[0].expiresAt.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US")}`, `ينتهي في ${subs[0].expiresAt.toLocaleDateString("ar-EG")}`)
                      : t(`${subs.length} active subscriptions`, `${subs.length} اشتراكات نشطة`)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ProgressRing({
  percent,
  size = 72,
  strokeWidth = 6,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/50"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-primary transition-all duration-700"
      />
    </svg>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  color: string;
  href?: string;
}) {
  const content = (
    <div className="rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/20 hover:shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function QuickAction({
  href,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-sm"
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-sm font-medium">{label}</span>
      {badge && (
        <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {badge}
        </span>
      )}
    </Link>
  );
}
