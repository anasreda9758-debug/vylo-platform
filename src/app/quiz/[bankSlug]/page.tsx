import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/shared/session";
import { getBankBySlug, getQuizQuestionsRandom, startAttempt } from "@/features/practice/queries";
import { QuizRunner } from "@/components/quiz-runner";
import { Navigation } from "@/components/navigation";
import { Lock, HelpCircle, Clock, BarChart3 } from "lucide-react";
import { getLocale, localize } from "@/shared/locale";
import { canAccessModule } from "@/features/access/learning-access";
import { isModuleAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";

export default async function QuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ bankSlug: string }>;
  searchParams: Promise<{ count?: string; difficulty?: string; time?: string }>;
}) {
  const { bankSlug } = await params;
  const { count: countParam, difficulty: diffParam, time: timeParam } = await searchParams;
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const bank = await getBankBySlug(bankSlug);
  if (!bank) notFound();
  if (!bank.module || !(await isModuleAcademicallyVisible(session.user, bank.module))) notFound();

  const moduleName = bank.module?.name ?? t("this module", "هذا الموديول");
  const access = bank.module ? (await canAccessModule(session.user, bank.module)).ok : false;

  const count = countParam ? parseInt(countParam, 10) : 0;
  const validCount = [10, 25, 50].includes(count) ? count : 0;
  const difficulty = diffParam && ["easy", "medium", "hard"].includes(diffParam) ? diffParam : undefined;
  const timeLimit = timeParam ? parseInt(timeParam, 10) : undefined;
  const validTime = timeLimit && [600, 1200, 1800].includes(timeLimit) ? timeLimit : undefined;

  const questions = validCount > 0
    ? await getQuizQuestionsRandom(bank.id, validCount, { difficulty, userId: session.user.id })
    : [];

  const attemptId =
    access && questions.length > 0 ? (await startAttempt(session.user.id, bank.id, { timeLimitSec: validTime })).id : null;

  const hasConfig = validCount > 0 && questions.length > 0;

  return (
    <div className="flex flex-1">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          {/* Breadcrumb */}
          <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            {bank.module && (
              <>
                <Link
                  href={`/curriculum/${bank.module.slug}`}
                  className="hover:text-foreground"
                >
                  {moduleName}
                </Link>
                <span>/</span>
              </>
            )}
            <span className="text-foreground">{bank.title}</span>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{bank.title}</h1>
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <HelpCircle className="h-3 w-3" />
                {t("Quiz", "اختبار")}: {bank.title}
              </span>
              <span className="text-sm text-muted-foreground">{moduleName}</span>
              <Link
                href="/quiz/history"
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <BarChart3 className="h-3 w-3" />
                {t("Quiz history", "تاريخ الاختبارات")}
              </Link>
            </div>
          </div>

          {!access ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20">
              <Lock className="mx-auto mb-4 h-12 w-12 text-amber-400" />
              <h2 className="mb-2 text-xl font-semibold">
                {t("This quiz is locked", "هذا الاختبار مدفوع")}
              </h2>
              <p className="mb-6 text-muted-foreground">
                {t("Purchase the module, term, or academic year to unlock its quizzes.", "اشترِ الموديول أو الترم أو السنة لفتح اختبارات هذا الموديول.")}
              </p>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("View plans", "عرض الأسعار والاشتراك")}
              </Link>
            </div>
          ) : hasConfig ? (
            <QuizRunner
              bankSlug={bankSlug}
              moduleSlug={bank.module?.slug ?? ""}
              questions={questions}
              timeLimitSec={validTime}
              attemptId={attemptId}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 text-center">
              <HelpCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <h2 className="mb-2 text-xl font-semibold">{t("Quiz setup", "إعداد الاختبار")}</h2>
              <p className="mb-6 text-muted-foreground">{t("Choose your quiz settings", "اختار إعدادات الاختبار")}</p>

              {/* Question count */}
              <div className="mb-6">
                <p className="mb-3 text-sm font-medium text-muted-foreground">{t("Question count", "عدد الأسئلة")}</p>
                <div className="flex flex-wrap justify-center gap-4">
                  {[10, 25, 50].map((n) => (
                    <Link
                      key={n}
                      href={`/quiz/${bankSlug}?count=${n}${difficulty ? `&difficulty=${difficulty}` : ""}${validTime ? `&time=${validTime}` : ""}`}
                      className={`flex h-24 w-28 flex-col items-center justify-center rounded-xl border transition-colors ${
                        validCount === n
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:border-primary hover:bg-primary/5"
                      }`}
                    >
                      <span className="text-3xl font-bold">{n}</span>
                      <span className="mt-1 text-sm text-muted-foreground">{t("questions", "سؤال")}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div className="mb-6">
                <p className="mb-3 text-sm font-medium text-muted-foreground">{t("Difficulty", "مستوى الصعوبة")}</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {[
                    { value: "", label: t("All", "الكل"), color: "border-border" },
                    { value: "easy", label: t("Easy", "سهل"), color: "border-emerald-500" },
                    { value: "medium", label: t("Medium", "متوسط"), color: "border-amber-500" },
                    { value: "hard", label: t("Hard", "صعب"), color: "border-red-500" },
                  ].map((d) => (
                    <Link
                      key={d.value}
                      href={`/quiz/${bankSlug}?count=${validCount || ""}${d.value ? `&difficulty=${d.value}` : ""}${validTime ? `&time=${validTime}` : ""}`}
                      className={`rounded-xl border-2 px-4 py-2 text-sm transition-colors ${
                        (difficulty ?? "") === d.value
                          ? `${d.color} bg-primary/5 font-medium`
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {d.label}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Time limit */}
              <div>
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  <Clock className="mr-1 inline h-3.5 w-3.5" />
                  {t("Time limit (optional)", "مهلة الوقت (اختياري)")}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {[
                    { value: "", label: t("No time limit", "بدون مهلة") },
                    { value: "600", label: t("10 minutes", "10 دقائق") },
                    { value: "1200", label: t("20 minutes", "20 دقيقة") },
                    { value: "1800", label: t("30 minutes", "30 دقيقة") },
                  ].map((t) => (
                    <Link
                      key={t.value}
                      href={`/quiz/${bankSlug}?count=${validCount || ""}${difficulty ? `&difficulty=${difficulty}` : ""}${t.value ? `&time=${t.value}` : ""}`}
                      className={`rounded-xl border-2 px-4 py-2 text-sm transition-colors ${
                        (validTime?.toString() ?? "") === t.value
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {t.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
