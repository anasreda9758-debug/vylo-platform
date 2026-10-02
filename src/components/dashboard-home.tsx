import Link from "next/link";
import { ArrowRight, BookOpen, Brain, RefreshCw, Stethoscope, FlaskConical, Lock, ChevronDown } from "lucide-react";
import { AcademicYearSelector } from "@/components/academic-year-selector";
import WeeklyPlanCard from "@/components/weekly-plan-card";

type ModuleProgress = { name: string; slug: string; completedLectures: number; totalLectures: number; percent: number; access: boolean };
type Props = {
  name: string; years: number[]; year: number; locale: "en" | "ar";
  nextLecture: { title: string; slug: string; moduleName: string; durationMin: number | null } | null;
  modules: ModuleProgress[]; due: number; completed: number; total: number; percent: number;
  accuracy: number | null; score: number; level: number; xp: number;
  weakModule: { moduleName: string; moduleSlug: string } | null;
  recent: { id: string; bankTitle: string; moduleName: string; score: number; total: number; completedAt: Date | null }[];
  terms: { term: number; percent: number; hasContent: boolean; completedLectures: number; totalLectures: number }[];
  subscriptions: { expiresAt: Date }[];
};

const linkStyle = "rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function DashboardHome(props: Props) {
  const t = (en: string, ar: string) => props.locale === "ar" ? ar : en;
  const next = props.nextLecture;
  return (
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 text-sm text-muted-foreground">{t("Your study home", "مساحتك للمذاكرة")}</p>
            <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{t(`Welcome back, ${props.name}`, `مرحبًا بعودتك، ${props.name}`)}</h1>
          </div>
          <AcademicYearSelector years={props.years} value={props.year} />
        </header>

        <section aria-labelledby="continue-title" className="rounded-2xl border border-border bg-card p-5 sm:p-7">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 max-w-2xl">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-primary"><BookOpen className="h-4 w-4" aria-hidden="true" />{t("Continue studying", "واصل المذاكرة")}</p>
              <h2 id="continue-title" className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{next?.title ?? t("Choose your next lecture", "اختر محاضرتك التالية")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{next ? next.moduleName : t("Explore your curriculum and find a good place to start.", "تصفح منهجك واختر نقطة مناسبة للبدء.")}{next?.durationMin ? t(` · ${next.durationMin} min`, ` · ${next.durationMin} دقيقة`) : ""}</p>
            </div>
            <Link href={next ? `/lecture/${next.slug}` : "/curriculum"} className={`${linkStyle} inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90`}>
              {next ? t("Continue lecture", "واصل المحاضرة") : t("Browse curriculum", "تصفح المنهج")}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-6 grid gap-3 border-t pt-5 sm:grid-cols-2">
            <Link href={props.due > 0 ? "/review" : "/flashcards"} className={`${linkStyle} flex items-start gap-3 bg-muted/50 p-4 hover:bg-muted`}>
              <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div><p className="text-sm font-semibold">{props.due > 0 ? t(`${props.due} questions due for review`, `${props.due} أسئلة مستحقة للمراجعة`) : t("Keep your recall fresh", "حافظ على تذكر المعلومات")}</p><p className="mt-1 text-sm text-muted-foreground">{props.due > 0 ? t("Pick up your scheduled question review.", "ابدأ مراجعة الأسئلة المجدولة.") : t("Open your flashcards for a quick review.", "افتح بطاقاتك لمراجعة سريعة.")}</p></div>
            </Link>
            <Link href={props.weakModule ? `/curriculum/${props.weakModule.moduleSlug}` : "/curriculum"} className={`${linkStyle} flex items-start gap-3 bg-muted/50 p-4 hover:bg-muted`}>
              <Brain className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div><p className="text-sm font-semibold">{t("Check your understanding", "اختبر فهمك")}</p><p className="mt-1 break-words text-sm text-muted-foreground">{props.weakModule ? t(`Revisit ${props.weakModule.moduleName}`, `راجع ${props.weakModule.moduleName}`) : t("Choose a module and try its quiz.", "اختر موديولًا وجرب اختباره.")}</p></div>
            </Link>
          </div>
        </section>

        <section aria-label={t("Learning snapshot", "لمحة عن تقدمك")} className="grid grid-cols-2 gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-4 sm:p-6">
          {[
            { label: t("Lectures completed", "محاضرات مكتملة"), value: `${props.completed}/${props.total}`, detail: t(`${props.percent}% of your year`, `${props.percent}% من سنتك`) },
            { label: t("Quiz accuracy", "دقة الإجابات"), value: props.accuracy === null ? "—" : `${props.accuracy}%`, detail: t("Completed quiz answers", "إجابات الاختبارات المكتملة") },
            { label: t("Review due", "مراجعات مستحقة"), value: String(props.due), detail: t("Scheduled questions", "أسئلة مجدولة") },
            { label: t("Your level", "مستواك"), value: `${props.level}`, detail: `${props.xp} XP` },
          ].map(item => <div key={item.label} className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{item.label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p></div>)}
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="modules-title" className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 id="modules-title" className="text-lg font-semibold">{t("Your modules", "موديولاتك")}</h2><Link href="/curriculum" className="text-sm text-primary underline-offset-4 hover:underline">{t("View curriculum", "عرض المنهج")}</Link></div>
            {props.modules.length ? <ul className="divide-y">{props.modules.map(module => <li key={module.slug} className="py-4 first:pt-0 last:pb-0"><Link href={`/curriculum/${module.slug}`} className={`${linkStyle} group block`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium leading-relaxed group-hover:text-primary">{module.name}</h3><p className="mt-1 text-xs text-muted-foreground">{t(`${module.completedLectures} of ${module.totalLectures} lectures complete`, `${module.completedLectures} من ${module.totalLectures} محاضرة مكتملة`)}</p></div>{!module.access ? <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" aria-hidden="true" />{t("Locked", "مقفل")}</span> : <span className="text-sm tabular-nums text-muted-foreground">{module.percent}%</span>}</div><div role="progressbar" aria-label={module.name} aria-valuenow={module.percent} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${module.percent}%` }} /></div></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">{t("No modules are available for this year yet.", "لا توجد موديولات لهذه السنة بعد.")}</p>}
          </section>
          <div className="space-y-6">
            <section aria-labelledby="tools-title" className="rounded-2xl border bg-card p-5 sm:p-6"><h2 id="tools-title" className="mb-4 text-lg font-semibold">{t("Practice & recall", "تدريب ومراجعة")}</h2><div className="space-y-2">{[
              { href: "/flashcards", icon: Brain, title: t("Flashcards", "البطاقات التعليمية"), detail: t("Review your saved cards", "راجع بطاقاتك المحفوظة") },
              { href: "/cases", icon: Stethoscope, title: t("Clinical cases", "حالات سريرية"), detail: t("Apply what you have learned", "طبق ما تعلمته") },
              { href: "/ospe", icon: FlaskConical, title: t("Practical & OSPE", "البراكتكال وOSPE"), detail: t("Explore available practice", "استكشف التدريب المتاح") },
            ].map(tool => <Link key={tool.href} href={tool.href} className={`${linkStyle} flex min-h-16 items-center gap-3 p-3 hover:bg-muted`}><tool.icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{tool.title}</p><p className="mt-1 text-xs text-muted-foreground">{tool.detail}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" /></Link>)}</div></section>
            <section className="rounded-2xl border bg-card p-5 sm:p-6"><div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("Recent quizzes", "آخر الاختبارات")}</h2><Link href="/quiz/history" className="text-sm text-primary hover:underline">{t("History", "السجل")}</Link></div>{props.recent.length ? <ul className="divide-y">{props.recent.map(quiz => <li key={quiz.id} className="flex items-start gap-3 py-3"><span className="rounded-lg bg-muted px-2 py-1 text-sm font-medium tabular-nums">{quiz.score}/{quiz.total}</span><div className="min-w-0"><p className="break-words text-sm font-medium">{quiz.bankTitle}</p><p className="mt-1 text-xs text-muted-foreground">{quiz.moduleName}{quiz.completedAt ? ` · ${quiz.completedAt.toLocaleDateString(props.locale === "ar" ? "ar-EG" : "en-US", { month: "short", day: "numeric" })}` : ""}</p></div></li>)}</ul> : <p className="text-sm leading-relaxed text-muted-foreground">{t("Your completed quizzes will appear here. Start with a module quiz when you are ready.", "ستظهر اختباراتك المكتملة هنا. ابدأ باختبار موديول عندما تكون مستعدًا.")}</p>}</section>
          </div>
        </div>

        <details className="group rounded-2xl border bg-card"><summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:px-6">{t("Your weekly plan", "خطتك الأسبوعية")}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary><div className="px-3 pb-3 sm:px-4"><WeeklyPlanCard /></div></details>
        <details className="group rounded-2xl border bg-card"><summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:px-6">{t("Progress details", "تفاصيل التقدم")}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary><div className="space-y-5 border-t p-5 sm:p-6"><div><p className="font-medium">{t("Study Score", "مؤشر المذاكرة")}: {props.accuracy === null ? "—" : `${props.score}/100`}</p><p className="mt-1 text-sm text-muted-foreground">{t("Based on lecture completion, quiz accuracy and practice volume. This is not a prediction of exam performance.", "مبني على إكمال المحاضرات ودقة الإجابات وحجم التدريب، وليس توقعًا لنتيجة الامتحان.")}</p></div><div className="grid gap-3 sm:grid-cols-3">{props.terms.filter(term => term.hasContent).map(term => <div key={term.term} className="rounded-xl bg-muted/50 p-4"><p className="text-sm font-medium">{t(`Term ${term.term}`, `الترم ${term.term}`)}</p><p className="mt-1 text-sm text-muted-foreground">{term.completedLectures}/{term.totalLectures} · {term.percent}%</p></div>)}</div><Link href="/quiz/analytics" className="inline-block text-sm text-primary hover:underline">{t("View quiz analytics", "عرض تحليلات الاختبارات")}</Link>{props.subscriptions.length > 0 && <p className="text-sm text-muted-foreground">{t(`${props.subscriptions.length} active subscriptions`, `${props.subscriptions.length} اشتراكات نشطة`)} · <Link href="/pricing" className="text-primary hover:underline">{t("Manage plans", "عرض الخطط")}</Link></p>}</div></details>
      </div>
    </main>
  );
}
