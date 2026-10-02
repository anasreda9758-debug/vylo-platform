import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/shared/session";
import { getModuleBySlug } from "@/features/curriculum/queries";
import { getBankForModule } from "@/features/practice/queries";
import { getLocale, localize } from "@/shared/locale";
import { canAccessModule } from "@/features/access/learning-access";
import {
  isHiddenFromStudentCurriculum,
  moduleDescription,
} from "@/shared/curriculum-copy";
import { listPracticalTracks } from "@/features/practical/tracks";
import {
  StudentShell,
  StudentPage,
  StudentHeader,
  studentAction,
  studentLink,
} from "@/components/student-shell";
import {
  ModuleContinuation,
  ModuleLectures,
} from "@/components/module-experience";

export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tool?: string }>;
}) {
  const { slug } = await params;
  const { tool } = await searchParams;
  const session = await requireUser();
  const locale = await getLocale();
  const t = (en: string, ar: string) => localize(locale, en, ar);
  if (isHiddenFromStudentCurriculum(slug)) redirect("/curriculum");
  const mod = await getModuleBySlug(session.user.id, slug);
  if (!mod) notFound();
  const bank = await getBankForModule(mod.id);
  const access = (await canAccessModule(session.user, mod)).ok;
  const tracks = access
    ? (await listPracticalTracks(session.user, mod.slug)).tracks
    : [];
  const preview = mod.lectures[0] ?? null;
  const next = mod.lectures.find((lecture) => !lecture.completed) ?? null;
  return (
    <StudentShell user={session.user}>
      <StudentPage>
        <StudentHeader
          title={mod.name}
          description={
            moduleDescription(mod.slug, mod.description, locale) ?? undefined
          }
          context={
            <>
              <Link href="/curriculum" className="hover:text-foreground">
                {t("Modules", "الموديولات")}
              </Link>
              <span className="mx-2">/</span>
              {t(
                `Year ${mod.studyYear} · Term ${mod.term}`,
                `السنة ${mod.studyYear} · الترم ${mod.term}`,
              )}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-4 border-b pb-5 text-sm text-muted-foreground">
          <span>
            {mod.completedLectures}/{mod.totalLectures}{" "}
            {t("lectures complete", "محاضرة مكتملة")}
          </span>
          {mod.totalLectures > 0 && (
            <span>
              {mod.percent}% ·{" "}
              {access
                ? t("Available", "متاح")
                : t("Locked · preview available", "مقفل · معاينة متاحة")}
            </span>
          )}
        </div>
        {mod.totalLectures === 0 ? (
          <section>
            <h2 className="text-lg font-medium">
              {t("No lectures published yet", "لا توجد محاضرات منشورة بعد")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "Material will appear here when published. There is nothing to unlock yet.",
                "ستظهر المادة هنا عند نشرها. لا يوجد محتوى يتطلب الفتح بعد.",
              )}
            </p>
            <Link href="/curriculum" className={`${studentLink} mt-4`}>
              {t("Explore other modules", "استكشف موديولات أخرى")}
            </Link>
          </section>
        ) : !access ? (
          <section className="space-y-4">
            <h2 className="text-lg font-medium">
              {t("Full module access required", "يتطلب وصولًا للموديول كاملًا")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {t(
                "Preview the first lecture, or view plans to unlock the full sequence and study tools.",
                "عاين المحاضرة الأولى، أو اعرض الخطط لفتح المحاضرات والأدوات.",
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              {preview && (
                <Link
                  href={`/lecture/${preview.slug}`}
                  className={studentAction}
                >
                  {t("Read free preview", "اقرأ المعاينة المجانية")}
                </Link>
              )}
              <Link href="/pricing" className={studentLink}>
                {t("View plans", "عرض الخطط")}
              </Link>
            </div>
            {preview && (
              <p className="break-words text-sm text-muted-foreground">
                {preview.title}
              </p>
            )}
          </section>
        ) : (
          <>
            {tool === "quiz" && bank && (
              <Link href={`/quiz/${bank.slug}`} className={studentAction}>
                {t("Open module quiz", "افتح اختبار الموديول")}
              </Link>
            )}
            <ModuleContinuation lecture={next} locale={locale} tool={tool} />
            <section aria-labelledby="lectures-title">
              <h2 id="lectures-title" className="mb-5 text-lg font-semibold">
                {t("Lectures", "المحاضرات")}
              </h2>
              <ModuleLectures
                lectures={mod.lectures}
                moduleSlug={mod.slug}
                locale={locale}
                tool={tool}
              />
            </section>
            <section aria-labelledby="module-tools" className="border-t pt-6">
              <h2 id="module-tools" className="mb-3 text-lg font-semibold">
                {t("Study tools", "أدوات الدراسة")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {bank && (
                  <Link
                    href={`/quiz/${bank.slug}`}
                    className={tool === "quiz" ? studentAction : studentLink}
                  >
                    {t("Module quiz", "اختبار الموديول")}
                  </Link>
                )}
                {tracks.length > 0 && (
                  <Link
                    href={`/curriculum/${mod.slug}/practical`}
                    className={studentLink}
                  >
                    {t("Practical & available OSPE", "العملي وOSPE المتاح")}
                  </Link>
                )}
                <Link href="/flashcards" className={studentLink}>
                  {t("Flashcards", "البطاقات")}
                </Link>
                <Link href="/cases" className={studentLink}>
                  {t("Clinical cases", "الحالات السريرية")}
                </Link>
              </div>
              {!bank && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(
                    "No module quiz is available yet.",
                    "لا يوجد اختبار لهذا الموديول بعد.",
                  )}
                </p>
              )}
            </section>
          </>
        )}
      </StudentPage>
    </StudentShell>
  );
}
