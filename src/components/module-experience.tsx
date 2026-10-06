import Link from "next/link";
import { CheckCircle2, Lock } from "lucide-react";
import { CompleteButton } from "./complete-button";
import { studentAction, studentLink } from "./student-shell";

export type StudyLecture = {
  id: string;
  slug: string;
  title: string;
  subject: string | null;
  kind: string | null;
  durationMin: number | null;
  completed: boolean;
};
export type StudyModule = {
  id: string;
  slug: string;
  name: string;
  term: number;
  studyYear: number;
  totalLectures: number;
  completedLectures: number;
  percent: number;
  access: boolean;
  lectures: StudyLecture[];
};
const copy = (locale: "en" | "ar", en: string, ar: string) =>
  locale === "ar" ? ar : en;

export function ModuleList({
  modules,
  locale,
  tool,
}: {
  modules: StudyModule[];
  locale: "en" | "ar";
  tool?: string;
}) {
  const t = (en: string, ar: string) => copy(locale, en, ar);
  if (!modules.length)
    return (
      <div className="border-t py-8">
        <h2 className="font-medium">
          {t(
            "No modules in this selection",
            "لا توجد موديولات في هذا الاختيار",
          )}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Choose another term or academic year.",
            "اختر ترمًا أو سنة دراسية أخرى.",
          )}
        </p>
      </div>
    );
  return (
    <ul className="divide-y border-y">
      {modules.map((module) => {
        const next = module.lectures.find((lecture) => !lecture.completed);
        const hasContent = module.totalLectures > 0;
        const moduleHref = `/curriculum/${module.slug}${tool ? `?tool=${encodeURIComponent(tool)}` : ""}`;
        return (
          <li
            key={module.id}
            className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="mb-2 text-xs text-muted-foreground">
                {t(
                  `Year ${module.studyYear} · Term ${module.term}`,
                  `السنة ${module.studyYear} · الترم ${module.term}`,
                )}
              </p>
              <Link
                href={moduleHref}
                dir="auto"
                className="break-words text-base font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                {module.name}
              </Link>
              <p className="mt-2 text-sm text-muted-foreground">
                {hasContent
                  ? t(
                      `${module.completedLectures}/${module.totalLectures} lectures complete`,
                      `${module.completedLectures}/${module.totalLectures} محاضرة مكتملة`,
                    )
                  : t(
                      "No lectures published yet",
                      "لا توجد محاضرات منشورة بعد",
                    )}
              </p>
              {hasContent && (
                <div
                  role="progressbar"
                  aria-label={module.name}
                  aria-valuenow={module.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-3 h-1 max-w-md overflow-hidden rounded bg-muted"
                >
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${module.percent}%` }}
                  />
                </div>
              )}
              {hasContent && next && (
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  {t("Up next", "التالي")}: {next.title}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {!hasContent ? (
                  t("Coming soon", "قريبًا")
                ) : module.access ? (
                  t("Available", "متاح")
                ) : (
                  <>
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {t("Locked · preview available", "مقفل · معاينة متاحة")}
                  </>
                )}
              </span>
              {hasContent && module.access && next && !tool ? (
                <Link href={`/lecture/${next.slug}`} className={studentLink}>
                  {t("Continue", "متابعة")}
                </Link>
              ) : (
                <Link href={moduleHref} className={studentLink}>
                  {t("View module", "عرض الموديول")}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ModuleLectures({
  lectures,
  moduleSlug,
  locale,
  tool,
}: {
  lectures: StudyLecture[];
  moduleSlug: string;
  locale: "en" | "ar";
  tool?: string;
}) {
  const t = (en: string, ar: string) => copy(locale, en, ar);
  const nextId = lectures.find((lecture) => !lecture.completed)?.id;
  const groups = new Map<string, StudyLecture[]>();
  for (const lecture of lectures) {
    const subject = lecture.subject ?? t("General", "عام");
    groups.set(subject, [...(groups.get(subject) ?? []), lecture]);
  }
  return (
    <div className="space-y-8">
      {[...groups].map(([subject, items]) => (
        <section key={subject}>
          <h3 className="mb-3 font-medium">{subject}</h3>
          <ul className="divide-y border-y">
            {items.map((lecture) => (
              <li
                key={lecture.id}
                className="flex flex-wrap items-center gap-3 py-4"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <Link
                    href={`/lecture/${lecture.slug}${tool === "tutor" ? "?tool=tutor" : ""}`}
                    dir="auto"
                    className="block break-words text-sm font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {lecture.title}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {lecture.completed ? (
                      <>
                        <CheckCircle2
                          className="h-3.5 w-3.5 text-primary"
                          aria-hidden="true"
                        />
                        {t("Completed", "مكتملة")}
                      </>
                    ) : lecture.id === nextId ? (
                      t("Current · ready to study", "الحالية · جاهزة للدراسة")
                    ) : (
                      t("Upcoming · available", "قادمة · متاحة")
                    )}
                    {lecture.kind && <span>· {lecture.kind}</span>}
                    {lecture.durationMin && (
                      <span>
                        · {lecture.durationMin} {t("min", "دقيقة")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="[&_button]:min-h-11 [&_button]:border [&_button]:border-border [&_button]:bg-transparent [&_button]:text-muted-foreground [&_button]:shadow-none [&_button]:hover:bg-muted">
                  <CompleteButton
                    lectureId={lecture.id}
                    moduleSlug={moduleSlug}
                    completed={lecture.completed}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ModuleContinuation({
  lecture,
  locale,
  tool,
}: {
  lecture: StudyLecture | null;
  locale: "en" | "ar";
  tool?: string;
}) {
  const t = (en: string, ar: string) => copy(locale, en, ar);
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5 sm:p-6">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {t("Continue studying", "واصل الدراسة")}
        </p>
        <h2 className="mt-2 break-words text-lg font-medium">
          {lecture?.title ??
            t("You have completed this module", "لقد أكملت هذا الموديول")}
        </h2>
      </div>
      {lecture && (
        <Link
          href={`/lecture/${lecture.slug}${tool === "tutor" ? "?tool=tutor" : ""}`}
          className={studentAction}
        >
          {tool === "tutor"
            ? t("Ask VYLO", "اسأل VYLO")
            : t("Continue lecture", "واصل المحاضرة")}
        </Link>
      )}
    </section>
  );
}
