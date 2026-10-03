import Link from "next/link";
import { requireUser } from "@/shared/session";
import { db } from "@/shared/db";
import { questionReview, question, questionOption, questionBank, quizAnswer, quizAttempt } from "@/features/practice/schema";
import { curriculumModule } from "@/features/curriculum/schema";
import { and, eq, lte, desc, asc, sql, gte, lt } from "drizzle-orm";
import { Navigation } from "@/components/navigation";
import { ReviewSession } from "@/components/review-session";
import { Brain, Clock, CheckCircle2, AlertCircle, BookOpen } from "lucide-react";
import { getLocale, localize } from "@/shared/locale";
import { getAccessibleQuestionReview } from "@/features/access/learning-access";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const session = await requireUser();
  const params = await searchParams;
  const wrongOnly = params.mode === "wrong";
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);

  // Get due questions with their details
  const dueReviews = await db
    .select({
      reviewId: questionReview.id,
      questionId: questionReview.questionId,
      easeFactor: questionReview.easeFactor,
      interval: questionReview.interval,
      repetitions: questionReview.repetitions,
      totalReviews: questionReview.totalReviews,
      correctCount: questionReview.correctCount,
      nextReview: questionReview.nextReview,
      prompt: question.prompt,
      explanation: question.explanation,
      difficulty: question.difficulty,
      bankSlug: questionBank.slug,
      bankTitle: questionBank.title,
      moduleName: curriculumModule.name,
      moduleSlug: curriculumModule.slug,
    })
    .from(questionReview)
    .innerJoin(question, eq(questionReview.questionId, question.id))
    .innerJoin(questionBank, eq(question.bankId, questionBank.id))
    .innerJoin(curriculumModule, eq(questionBank.moduleId, curriculumModule.id))
    .where(and(
      eq(questionReview.userId, session.user.id),
      wrongOnly
        ? lt(questionReview.correctCount, questionReview.totalReviews)
        : lte(questionReview.nextReview, new Date()),
    ))
    .orderBy(wrongOnly ? desc(questionReview.updatedAt) : asc(questionReview.nextReview))
    .limit(20);

  // A review record can outlive a subscription. Do not render its protected
  // question content until current module access is confirmed.
  const accessibleDueReviews = [] as typeof dueReviews;
  for (const row of dueReviews) {
    const access = await getAccessibleQuestionReview(session.user, row.questionId);
    if (access.ok) accessibleDueReviews.push(row);
  }

  // Get options for each currently accessible due question
  const questionsWithOptions = await Promise.all(
    accessibleDueReviews.map(async (r) => {
      const opts = await db
        .select({ id: questionOption.id, text: questionOption.text })
        .from(questionOption)
        .where(eq(questionOption.questionId, r.questionId))
        .orderBy(asc(questionOption.order));
      return { ...r, options: opts };
    }),
  );

  // Stats
  const [totalReviewed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questionReview)
    .where(eq(questionReview.userId, session.user.id));

  const [masteredCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questionReview)
    .where(and(eq(questionReview.userId, session.user.id), gte(questionReview.interval, 21)));

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />
      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{t("Question review", "مراجعة الأسئلة")}</h1>
            <p className="mt-1 text-muted-foreground">
              {wrongOnly
                ? t("Strengthen concepts from questions you previously missed.", "قوِّ المفاهيم من الأسئلة التي أخطأت فيها سابقًا.")
                : t("Review questions that are due, scheduled with spaced repetition.", "راجع الأسئلة التي حان وقتها بناءً على منحنى النسيان.")}
            </p>
          </div>

          <div className="mb-6 inline-flex rounded-xl border border-border bg-card p-1">
            <Link href="/review" className={`rounded-lg px-3 py-2 text-sm font-medium ${!wrongOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {t("Due now", "المستحق الآن")}
            </Link>
            <Link href="/review?mode=wrong" className={`rounded-lg px-3 py-2 text-sm font-medium ${wrongOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {t("Wrong answers only", "الأخطاء فقط")}
            </Link>
          </div>

          {/* Stats */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-xs font-medium text-muted-foreground">{wrongOnly ? t("Previously incorrect", "أخطاء سابقة") : t("Due now", "بانتظار المراجعة")}</span>
              </div>
              <p className="text-2xl font-bold">{accessibleDueReviews.length}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-600" />
                <span className="text-xs font-medium text-muted-foreground">{t("Total reviews", "إجمالي المراجعات")}</span>
              </div>
              <p className="text-2xl font-bold">{totalReviewed?.count ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-medium text-muted-foreground">{t("Mastered questions", "أسئلة متقنة")}</span>
              </div>
              <p className="text-2xl font-bold">{masteredCount?.count ?? 0}</p>
            </div>
          </div>

          {questionsWithOptions.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <Clock className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <h2 className="mb-2 text-xl font-semibold">{wrongOnly ? t("No incorrect answers to revisit", "لا توجد أخطاء لمراجعتها") : t("No questions due for review", "لا توجد أسئلة للمراجعة")}</h2>
              <p className="mb-6 text-muted-foreground">
                {wrongOnly
                  ? t("When you miss a question in a quiz, it will appear here for focused practice.", "عندما تخطئ في سؤال داخل اختبار سيظهر هنا للمراجعة المركزة.")
                  : t("Complete a quiz first; your questions will then be scheduled here for review.", "أجب على بعض الاختبارات أولاً، وسيتم جدولة الأسئلة للمراجعة هنا.")}
              </p>
              <Link
                href="/curriculum"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <BookOpen className="h-4 w-4" />
                {t("Browse curriculum", "تصفح المنهج")}
              </Link>
            </div>
          ) : (
            <ReviewSession questions={questionsWithOptions} />
          )}
        </div>
      </main>
    </div>
  );
}
