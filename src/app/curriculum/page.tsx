import Link from "next/link";
import { requireUser } from "@/shared/session";
import { getStudyYears } from "@/features/curriculum/queries";
import { getCachedCurriculum } from "@/shared/query-cache";
import { getLocale, localize } from "@/shared/locale";
import { getSelectedStudyYear } from "@/shared/study-year";
import { AcademicYearSelector } from "@/components/academic-year-selector";
import { canAccessModule } from "@/features/access/learning-access";
import {
  StudentShell,
  StudentPage,
  StudentHeader,
} from "@/components/student-shell";
import { ModuleList } from "@/components/module-experience";

const DEMO_MODULE_SLUGS = new Set(["anatomy-module-1", "respiratory-overview"]);

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string; year?: string; tool?: string }>;
}) {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (en: string, ar: string) => localize(locale, en, ar);
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
  const loaded = await getCachedCurriculum(
    session.user.id,
    isAdmin && !params.year ? undefined : studyYear,
  );
  const curriculum = isAdmin
    ? loaded
    : loaded.filter((module) => !DEMO_MODULE_SLUGS.has(module.slug));
  const activeTerm = params.term ? Number(params.term) : 0;
  const filtered = activeTerm
    ? curriculum.filter((module) => module.term === activeTerm)
    : curriculum;
  const modules = await Promise.all(
    filtered.map(async (module) => ({
      ...module,
      access: (await canAccessModule(session.user, module)).ok,
    })),
  );
  const tool =
    params.tool === "tutor" || params.tool === "quiz" ? params.tool : undefined;
  const suffix = tool ? `&tool=${tool}` : "";
  const terms = [
    ...new Set([
      ...curriculum.map((module) => module.term),
      studyYear * 2 - 1,
      studyYear * 2,
    ]),
  ].sort((a, b) => a - b);
  return (
    <StudentShell user={session.user}>
      <StudentPage>
        <StudentHeader
          title={
            tool === "quiz"
              ? t("Question Bank", "بنك الأسئلة")
              : tool === "tutor"
                ? t("AI Tutor", "المعلم الذكي")
                : t("Modules", "الموديولات")
          }
          description={
            tool === "quiz"
              ? t(
                  "Choose a module to open its available quiz. Saved questions and review are in More tools.",
                  "اختر موديولًا لفتح اختباره المتاح. المراجعات والأسئلة المحفوظة في أدوات أخرى.",
                )
              : tool === "tutor"
                ? t(
                    "Choose a module, then a lecture. Ask VYLO uses that lecture's learning material.",
                    "اختر موديولًا ثم محاضرة. يستخدم VYLO مادة تلك المحاضرة للإجابة.",
                  )
                : t(
                    "Your learning path, one module at a time.",
                    "مسارك الدراسي، موديولًا بعد الآخر.",
                  )
          }
          action={
            <AcademicYearSelector years={availableYears} value={studyYear} />
          }
        />
        <nav
          aria-label={t("Filter by term", "اختر الترم")}
          className="flex flex-wrap gap-2"
        >
          <Link
            aria-current={!activeTerm ? "page" : undefined}
            href={`/curriculum?year=${studyYear}${suffix}`}
            className={`min-h-11 rounded-lg px-4 py-3 text-sm ${!activeTerm ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t("All modules", "كل الموديولات")}
          </Link>
          {terms.map((term) => (
            <Link
              key={term}
              aria-current={activeTerm === term ? "page" : undefined}
              href={`/curriculum?year=${studyYear}&term=${term}${suffix}`}
              className={`min-h-11 rounded-lg px-4 py-3 text-sm ${activeTerm === term ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
            >
              {t(`Term ${term}`, `الترم ${term}`)}
            </Link>
          ))}
        </nav>
        <ModuleList modules={modules} locale={locale} tool={tool} />
      </StudentPage>
    </StudentShell>
  );
}
