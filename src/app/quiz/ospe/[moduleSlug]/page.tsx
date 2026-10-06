import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/shared/session";
import { getBankBySlug, getQuizQuestionsRandom, startAttempt } from "@/features/practice/queries";
import { OspeQuizRunner } from "@/components/ospe-quiz-runner";
import { Navigation } from "@/components/navigation";
import { Lock, HelpCircle, Clock, Stethoscope } from "lucide-react";
import { canAccessModule } from "@/features/access/learning-access";
import { isModuleAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";

export default async function OspeQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ moduleSlug: string }>;
  searchParams: Promise<{ count?: string; difficulty?: string; time?: string }>;
}) {
  const { moduleSlug } = await params;
  const { count: countParam, difficulty: diffParam, time: timeParam } = await searchParams;
  const session = await requireUser();
  const bank = await getBankBySlug(`ospe-${moduleSlug}`);
  if (!bank) notFound();
  if (!bank.module || !(await isModuleAcademicallyVisible(session.user, bank.module))) notFound();

  const moduleName = bank.module?.name ?? "هذا الموديول";
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
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          {/* Breadcrumb */}
          <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/quiz/ospe" className="hover:text-foreground">
              OSPE
            </Link>
            <span>/</span>
            <span className="text-foreground">{moduleName}</span>
          </div>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Stethoscope className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">OSPE · {moduleName}</h1>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <HelpCircle className="h-3 w-3" />
                    اختبار سريري
                  </span>
                  <span className="text-sm text-muted-foreground">{bank.title}</span>
                </div>
              </div>
            </div>
          </div>

          {!access ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20">
              <Lock className="mx-auto mb-4 h-12 w-12 text-amber-400" />
              <h2 className="mb-2 text-xl font-semibold">هذا الموديول مدفوع</h2>
              <p className="mb-6 text-muted-foreground">
                اشترِ الموديول أو الترم لفتح اختبارات هذا الموديول.
              </p>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                عرض الأسعار والاشتراك
              </Link>
            </div>
          ) : hasConfig ? (
            <OspeQuizRunner
              bankSlug={`ospe-${moduleSlug}`}
              moduleSlug={moduleSlug}
              questions={questions}
              timeLimitSec={validTime}
              attemptId={attemptId}
            />
          ) : (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center">
              <Stethoscope className="mx-auto mb-4 h-12 w-12 text-primary" />
              <h2 className="mb-2 text-xl font-bold">إعداد محطات OSPE</h2>
              <p className="mb-6 text-muted-foreground">اختار عدد المحطات ومستوى الصعوبة</p>

              {/* Question count */}
              <div className="mb-6">
                <p className="mb-3 text-sm font-medium text-muted-foreground">عدد المحطات</p>
                <div className="flex flex-wrap justify-center gap-4">
                  {[10, 25, 50].map((n) => (
                    <Link
                      key={n}
                      href={`/quiz/ospe/${moduleSlug}?count=${n}${difficulty ? `&difficulty=${difficulty}` : ""}${validTime ? `&time=${validTime}` : ""}`}
                      className={`flex h-24 w-28 flex-col items-center justify-center rounded-xl border transition-colors ${
                        validCount === n
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:border-primary hover:bg-primary/5"
                      }`}
                    >
                      <span className="text-3xl font-bold">{n}</span>
                      <span className="mt-1 text-sm text-muted-foreground">محطة</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div className="mb-6">
                <p className="mb-3 text-sm font-medium text-muted-foreground">مستوى الصعوبة</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {[
                    { value: "", label: "الكل", color: "border-border" },
                    { value: "easy", label: "سهل", color: "border-emerald-500" },
                    { value: "medium", label: "متوسط", color: "border-amber-500" },
                    { value: "hard", label: "صعب", color: "border-red-500" },
                  ].map((d) => (
                    <Link
                      key={d.value}
                      href={`/quiz/ospe/${moduleSlug}?count=${validCount || ""}${d.value ? `&difficulty=${d.value}` : ""}${validTime ? `&time=${validTime}` : ""}`}
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
                  مهلة الوقت (اختياري)
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {[
                    { value: "", label: "بدون مهلة" },
                    { value: "600", label: "10 دقائق" },
                    { value: "1200", label: "20 دقيقة" },
                    { value: "1800", label: "30 دقيقة" },
                  ].map((t) => (
                    <Link
                      key={t.value}
                      href={`/quiz/ospe/${moduleSlug}?count=${validCount || ""}${difficulty ? `&difficulty=${difficulty}` : ""}${t.value ? `&time=${t.value}` : ""}`}
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
