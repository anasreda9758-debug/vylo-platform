import { requireUser } from "@/shared/session";
import { getQuizAnalytics } from "@/features/practice/queries";
import { Navigation } from "@/components/navigation";
import Link from "next/link";
import {
  BarChart3,
  Clock,
  Target,
  TrendingUp,
  Zap,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { getLocale, localize } from "@/shared/locale";

export default async function QuizAnalyticsPage() {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const analytics = await getQuizAnalytics(session.user);
  const { overall, accuracyOverTime, perModule, byDifficulty, avgTimeByDifficulty } = analytics;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />
      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{t("Quiz analytics", "تحليلات الاختبارات")}</h1>
            <p className="mt-1 text-muted-foreground">
              {t("A complete view of your performance across quizzes.", "نظرة شاملة على أدائك في جميع الاختبارات.")}
            </p>
          </div>

          {overall.totalAttempts === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <BarChart3 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">{t("You have not completed a quiz yet.", "لم تقم بأي اختبار بعد.")}</p>
              <Link
                href="/curriculum"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t("Start a quiz", "ابدأ اختباراً")}
              </Link>
            </div>
          ) : (
            <>
              {/* Overall Stats */}
              <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard
                  icon={Target}
                  label={t("Average score", "متوسط النسبة")}
                  value={`${overall.avgPercent}%`}
                  color="text-blue-600 bg-blue-50 dark:bg-blue-950/40"
                />
                <StatCard
                  icon={Zap}
                  label={t("Best score", "أفضل نتيجة")}
                  value={`${overall.bestPercent}%`}
                  color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                />
                <StatCard
                  icon={BarChart3}
                  label={t("Quizzes completed", "عدد الاختبارات")}
                  value={String(overall.totalAttempts)}
                  color="text-purple-600 bg-purple-50 dark:bg-purple-950/40"
                />
                <StatCard
                  icon={CheckCircle2}
                  label={t("Total answers", "إجمالي الإجابات")}
                  value={`${overall.totalCorrect}/${overall.totalAnswered}`}
                  sub={t(`${overall.totalAnswered > 0 ? Math.round((overall.totalCorrect / overall.totalAnswered) * 100) : 0}% correct`, `${overall.totalAnswered > 0 ? Math.round((overall.totalCorrect / overall.totalAnswered) * 100) : 0}% صحيحة`)}
                  color="text-amber-600 bg-amber-50 dark:bg-amber-950/40"
                />
                <StatCard
                  icon={Clock}
                  label={t("Average time", "متوسط الوقت")}
                  value={`${overall.avgTimePerQuestion}s`}
                  sub={t("per question", "لكل سؤال")}
                  color="text-red-600 bg-red-50 dark:bg-red-950/40"
                />
              </div>

              {/* Accuracy Over Time */}
              {accuracyOverTime.length > 1 && (
                <div className="mb-8 rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-muted-foreground" />
                    <h2 className="font-semibold">{t("Performance over time", "تطور الأداء خلال الوقت")}</h2>
                  </div>
                  <div className="flex items-end gap-1" style={{ height: 160 }}>
                    {accuracyOverTime.map((d) => (
                      <div key={d.date} className="group relative flex-1">
                        <div
                          className="mx-auto w-full max-w-[40px] rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                          style={{ height: `${d.percent}%`, minHeight: d.percent > 0 ? 4 : 0 }}
                        />
                        <div className="mt-1 text-center text-[10px] text-muted-foreground">
                          {d.date.slice(5)}
                        </div>
                        {/* Tooltip */}
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs text-background shadow-lg group-hover:block">
                          {d.percent}% ({d.correct}/{d.total})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Per-Module Accuracy */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="mb-4 font-semibold">{t("Accuracy by module", "الدقة حسب الموديول")}</h2>
                  <ul className="space-y-3">
                    {perModule.map((m) => (
                      <li key={m.moduleSlug}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium">{m.moduleName}</span>
                          <span className="text-muted-foreground">
                            {m.correct}/{m.total} ({m.percent}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all ${
                              m.percent >= 80
                                ? "bg-emerald-500"
                                : m.percent >= 50
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${m.percent}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {t("Average time", "متوسط الوقت")}: {m.avgTimeMs > 0 ? `${Math.round(m.avgTimeMs / 1000)}s` : "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Difficulty Breakdown */}
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="mb-4 font-semibold">{t("Breakdown by difficulty", "التحليل حسب الصعوبة")}</h2>
                  <div className="space-y-4">
                    {byDifficulty.map((d) => {
                      const diffLabel =
                        d.difficulty === "easy"
                          ? t("Easy", "سهل")
                          : d.difficulty === "hard"
                            ? t("Hard", "صعب")
                            : t("Medium", "متوسط");
                      const diffColor =
                        d.difficulty === "easy"
                          ? "text-emerald-600"
                          : d.difficulty === "hard"
                            ? "text-red-600"
                            : "text-amber-600";
                      const timing = avgTimeByDifficulty.find((t) => t.difficulty === d.difficulty);
                      return (
                        <div key={d.difficulty} className="rounded-lg bg-muted/50 p-4">
                          <div className="flex items-center justify-between">
                            <span className={`font-medium ${diffColor}`}>{diffLabel}</span>
                            <span className="text-sm text-muted-foreground">
                              {d.correct}/{d.total} ({d.percent}%)
                            </span>
                          </div>
                          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                d.difficulty === "easy"
                                  ? "bg-emerald-500"
                                  : d.difficulty === "hard"
                                    ? "bg-red-500"
                                    : "bg-amber-500"
                              }`}
                              style={{ width: `${d.percent}%` }}
                            />
                          </div>
                          {timing && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {t("Average time", "متوسط الوقت")}: {timing.avgSec}s {t("per question", "لكل سؤال")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Weak areas warning */}
                  {byDifficulty.some((d) => d.percent < 50 && d.total >= 3) && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                      <div className="flex items-center gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <span className="font-medium text-amber-600">{t("Weak area", "منطقة ضعف")}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("Some levels are below 50%. Review incorrect answers and try again.", "بعض المستويات تحت 50%. راجع الأسئلة الخاطئة وحاول مرة أخرى.")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
