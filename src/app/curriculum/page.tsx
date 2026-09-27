import Link from "next/link";
import { requireUser } from "@/shared/session";
import { getCurriculum, getStudyYears } from "@/features/curriculum/queries";
import { getCachedCurriculum } from "@/shared/query-cache";
import { ProgressBar } from "@/components/progress-bar";
import { Navigation } from "@/components/navigation";
import { BookOpen, Lock, Unlock, Calendar, Clock } from "lucide-react";
import { getLocale, localize } from "@/shared/locale";
import type { AppLocale } from "@/components/locale-provider";
import { moduleDescription } from "@/shared/curriculum-copy";
import { getSelectedStudyYear } from "@/shared/study-year";
import { AcademicYearSelector } from "@/components/academic-year-selector";

const DEMO_MODULE_SLUGS = new Set(["anatomy-module-1", "respiratory-overview"]);

const TERM_LABELS: Record<number, [string, string]> = {
  1: ["Term 1", "الترم الأول"],
  2: ["Term 2", "الترم الثاني"],
  3: ["Term 3", "الترم الثالث"],
  4: ["Term 4", "الترم الرابع"],
  5: ["Term 5", "الترم الخامس"],
  6: ["Term 6", "الترم السادس"],
  7: ["Term 7", "الترم السابع"],
  8: ["Term 8", "الترم الثامن"],
  9: ["Term 9", "الترم التاسع"],
  10: ["Term 10", "الترم العاشر"],
};

const TERM_ACCENTS = [
  {
    active: "border-blue-500 bg-blue-50 dark:bg-blue-950/30",
    idle: "border-border bg-card hover:border-blue-300",
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-900/50",
  },
  {
    active: "border-purple-500 bg-purple-50 dark:bg-purple-950/30",
    idle: "border-border bg-card hover:border-purple-300",
    icon: "bg-purple-100 text-purple-600 dark:bg-purple-900/50",
  },
  {
    active: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30",
    idle: "border-border bg-card hover:border-emerald-300",
    icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50",
  },
];

function ModuleCard({
  m,
  locale,
}: {
  m: NonNullable<Awaited<ReturnType<typeof getCurriculum>>>[number];
  locale: AppLocale;
}) {
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  return (
    <li>
      <Link
        href={`/curriculum/${m.slug}`}
        className="group block rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/20 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BookOpen className="h-4 w-4" />
              </div>
              <h2 className="text-base font-semibold leading-tight group-hover:text-primary">
                {m.name}
              </h2>
            </div>
            {moduleDescription(m.slug, m.description, locale) ? (
              <p className="mb-3 text-sm text-muted-foreground line-clamp-2">
                {moduleDescription(m.slug, m.description, locale)}
              </p>
            ) : null}
          </div>
          {m.totalLectures === 0 ? (
            /* Content truth: an empty module is not "locked". Badging it as paid
               implies there is something to buy, which is not the case. */
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3 w-3" />
              {t("Coming soon", "قريبًا")}
            </span>
          ) : m.isFree ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600">
              <Unlock className="h-3 w-3" />
              {t("Open", "مجاني")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600">
              <Lock className="h-3 w-3" />
              {t("Locked", "مدفوع")}
            </span>
          )}
        </div>
        {m.totalLectures > 0 ? (
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar percent={m.percent} />
            <span className="shrink-0 text-xs text-muted-foreground">
              {m.completedLectures}/{m.totalLectures}
            </span>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("No lectures published yet", "لا توجد محاضرات منشورة بعد")}
          </p>
        )}
      </Link>
    </li>
  );
}

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string; year?: string }>;
}) {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const params = await searchParams;
  const studyYears = await getStudyYears();
  const availableYears = studyYears.length ? studyYears : [1];
  const savedYear = await getSelectedStudyYear();
  const requestedYear = Number(params.year);
  const isAdmin = session.user.role === "admin";
  const studyYear = availableYears.includes(requestedYear)
    ? requestedYear
    : availableYears.includes(savedYear)
      ? savedYear
      : availableYears[0];
  const loadedCurriculum = await getCachedCurriculum(
    session.user.id,
    isAdmin && !params.year ? undefined : studyYear,
  );
  const curriculum = isAdmin
    ? loadedCurriculum
    : loadedCurriculum.filter((module) => !DEMO_MODULE_SLUGS.has(module.slug));
  const activeTerm = params.term ? Number(params.term) : 0;

  const yearTerms = [studyYear * 2 - 1, studyYear * 2];
  const modulesForTerm = (term: number) => curriculum.filter((m) => m.term === term);
  const filtered = activeTerm ? modulesForTerm(activeTerm) : curriculum;
  const activeLabel =
    activeTerm in TERM_LABELS
      ? t(TERM_LABELS[activeTerm][0], TERM_LABELS[activeTerm][1])
      : t("All modules", "جميع الموديولات");

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={isAdmin}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{t("Curriculum", "المنهج")}</h1>
              <p className="mt-1 text-muted-foreground">
                {t("Choose a term, then a module to browse its lectures.", "اختر الترم ثم الموديول لتصفح المحاضرات.")}
              </p>
            </div>
            <AcademicYearSelector years={availableYears} value={studyYear} />
          </div>

          {curriculum.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">{t("No modules are available yet.", "لا توجد وحدات بعد.")}</p>
            </div>
          ) : (
            <>
              {/* Term Selector */}
              <div className="mb-8 grid gap-4 sm:grid-cols-2">
                {yearTerms.map((term) => {
                  const accent = TERM_ACCENTS[(term - 1) % TERM_ACCENTS.length];
                  const termModules = modulesForTerm(term);
                  const done = termModules.reduce((s, m) => s + m.completedLectures, 0);
                  const total = termModules.reduce((s, m) => s + m.totalLectures, 0);
                  return (
                    <Link
                      key={term}
                      href={`/curriculum?year=${studyYear}&term=${term}`}
                      className={`group rounded-2xl border-2 p-5 transition-all hover:shadow-md ${
                        activeTerm === term ? accent.active : accent.idle
                      }`}
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent.icon}`}>
                          <Calendar className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold">
                            {t(TERM_LABELS[term][0], TERM_LABELS[term][1])}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {t(`${termModules.length} modules`, `${termModules.length} modules`)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <ProgressBar percent={total > 0 ? Math.round((done / total) * 100) : 0} />
                        <span className="shrink-0 text-xs">
                          {done}/{total}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* Show All / Active Term Label */}
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">
                  {activeLabel}
                </h2>
                {activeTerm !== 0 && (
                  <Link
                    href={`/curriculum?year=${studyYear}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {t("View all", "عرض الكل")}
                  </Link>
                )}
              </div>

              {/* Modules Grid */}
              <ul className="grid gap-4 sm:grid-cols-2">
                {filtered.map((m) => (
                  <ModuleCard key={m.id} m={m} locale={locale} />
                ))}
              </ul>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
