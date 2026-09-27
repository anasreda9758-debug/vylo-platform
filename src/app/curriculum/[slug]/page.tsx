import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/shared/session";
import { getModuleBySlug } from "@/features/curriculum/queries";
import { getBankForModule } from "@/features/practice/queries";
import { ProgressBar } from "@/components/progress-bar";
import { CompleteButton } from "@/components/complete-button";
import { Navigation } from "@/components/navigation";
import { getLocale, localize } from "@/shared/locale";
import { canAccessModule } from "@/features/access/learning-access";
import { isHiddenFromStudentCurriculum } from "@/shared/curriculum-copy";
import { listPracticalTracks } from "@/features/practical/tracks";
import {
  BookOpen,
  FileText,
  CheckCircle2,
  Clock,
  Lock,
  FlaskConical,
} from "lucide-react";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireUser();
  const locale = await getLocale();
  if (isHiddenFromStudentCurriculum(slug)) redirect("/curriculum");
  const mod = await getModuleBySlug(session.user.id, slug);
  if (!mod) notFound();
  const bank = await getBankForModule(mod.id);
  const access = (await canAccessModule(session.user, mod)).ok;
  const practicalTracks = access ? (await listPracticalTracks(session.user, mod.slug)).tracks : [];
  const previewLecture = mod.lectures[0] ?? null;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          {/* Breadcrumb */}
          <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/curriculum" className="hover:text-foreground">
              {localize(locale, "Curriculum", "المنهج")}
            </Link>
            <span>/</span>
            <span className="text-foreground">{mod.name}</span>
          </div>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">{mod.name}</h1>
                {mod.description ? (
                  <p className="mt-2 text-muted-foreground">{mod.description}</p>
                ) : null}
              </div>
              {!mod.isFree ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600">
                  <Lock className="h-3 w-3" />
                  {localize(locale, "Paid", "مدفوع")}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
                  {localize(locale, "Free", "مجاني")}
                </span>
              )}
            </div>
            {mod.totalLectures > 0 ? (
              <div className="mt-4 flex items-center gap-3">
                <ProgressBar percent={mod.percent} />
                <span className="shrink-0 text-sm text-muted-foreground">
                  {mod.completedLectures}/{mod.totalLectures} {localize(locale, "completed", "مكتملة")}
                </span>
              </div>
            ) : null}
          </div>

          {mod.totalLectures === 0 ? (
            /* A module with no published lectures must never be shown behind a
               paywall: there is nothing to unlock, so advertising a paid plan
               for it would be misleading. */
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <BookOpen className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <h2 className="mb-2 text-lg font-semibold">
                {localize(locale, "No lectures published yet", "لا توجد محاضرات منشورة بعد")}
              </h2>
              <p className="mx-auto max-w-lg text-sm text-muted-foreground">
                {localize(
                  locale,
                  "This module is part of the curriculum but its lectures have not been published yet. Nothing here is locked — there is simply nothing to study until the material is added.",
                  "هذا الموديول جزء من المنهج لكن محاضراته لم تُنشر بعد. لا يوجد محتوى مقفل هنا، بل لا يوجد ما يُدرَس حتى إضافة المادة.",
                )}
              </p>
              <Link
                href="/curriculum"
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                {localize(locale, "Back to curriculum", "العودة إلى المنهج")}
              </Link>
            </div>
          ) : !access ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20">
                <Lock className="mx-auto mb-4 h-12 w-12 text-amber-400" />
                <h2 className="mb-2 text-xl font-semibold">
                  {localize(locale, "This module requires access", "هذا الموديول مدفوع")}
                </h2>
                <p className="mb-6 text-muted-foreground">
                  {localize(locale, "Subscribe to this module or term to unlock the full lecture sequence, quizzes, and tutor.", "اشترِ الموديول أو الترم لفتح تسلسل المحاضرات والاختبارات والمعلم الذكي.")}
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {localize(locale, "View plans", "عرض الأسعار والاشتراك")}
                </Link>
              </div>
              {previewLecture && (
                <Link href={`/lecture/${previewLecture.slug}`} className="group block rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 transition hover:border-emerald-500/60">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><BookOpen className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-emerald-600">{localize(locale, "Free preview", "معاينة مجانية")}</p>
                      <p className="truncate font-semibold group-hover:text-primary">{previewLecture.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{localize(locale, "Read the first lecture and its study summary before subscribing.", "اقرأ المحاضرة الأولى وملخصها قبل الاشتراك.")}</p>
                    </div>
                  </div>
                </Link>
              )}
            </div>
          ) : (
            <>
              {/* Quiz Button */}
              {practicalTracks.length > 0 && <Link href={`/curriculum/${mod.slug}/practical`} className="mb-6 me-3 inline-flex items-center gap-2 rounded-xl border border-primary px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/10"><FlaskConical className="h-4 w-4" />{localize(locale, `Practical (${practicalTracks.length} ${practicalTracks.length === 1 ? "subject" : "subjects"})`, `العملي (${practicalTracks.length} مادة)`)}</Link>}
              {bank ? (
                <Link
                  href={`/quiz/${bank.slug}`}
                  className="mb-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <FlaskConical className="h-4 w-4" />
                  {localize(locale, `Module quiz (${bank.title})`, `اختبار الموديول (${bank.title})`)}
                </Link>
              ) : null}

              {/* Lectures */}
              {renderGroupedLectures(mod.lectures, mod.slug, locale)}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

type LectureRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  subject: string | null;
  kind: string | null;
  durationMin: number | null;
  completed: boolean;
};

const KIND_LABELS: Record<string, string> = {
  lecture: "محاضرات",
  seminar: "سيمينار",
  practical: "عملي",
};

const KIND_ICONS: Record<string, typeof BookOpen> = {
  lecture: BookOpen,
  seminar: FileText,
  practical: FlaskConical,
};

function renderGroupedLectures(
  lectures: LectureRow[],
  moduleSlug: string,
  locale: "en" | "ar",
) {
  const groups = new Map<string, Map<string, LectureRow[]>>();
  for (const l of lectures) {
    const subject = l.subject ?? localize(locale, "General", "عام");
    const kind = l.kind ?? "lecture";
    if (!groups.has(subject)) groups.set(subject, new Map());
    const kinds = groups.get(subject)!;
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind)!.push(l);
  }

  const order: Array<[string, Map<string, LectureRow[]>]> = [
    ...groups.entries(),
  ];
  if (order.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center">
        <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">
          {localize(locale, "No individual lectures have been added to this module yet.", "لا توجد محاضرات مفصّلة لهذا الموديول بعد.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {order.map(([subject, kinds]) => (
        <section key={subject}>
          <h2 className="mb-4 text-lg font-semibold">{subject}</h2>
          {[...kinds.entries()].map(([kind, items]) => {
            const KindIcon = KIND_ICONS[kind] ?? BookOpen;
            return (
              <div key={kind} className="mb-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <KindIcon className="h-3.5 w-3.5" />
                  {locale === "ar" ? KIND_LABELS[kind] ?? kind : kind === "lecture" ? "Lectures" : kind === "seminar" ? "Seminars" : kind === "practical" ? "Practical" : kind}
                </div>
                <ul className="space-y-2">
                  {items.map((l) => (
                    <li
                      key={l.id}
                      className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
                            l.completed
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {l.completed ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <BookOpen className="h-4 w-4" />
                          )}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold">
                            <Link
                              href={`/lecture/${l.slug}`}
                              className="transition-colors hover:text-primary"
                            >
                              {l.title}
                            </Link>
                          </h3>
                          {l.durationMin ? (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {l.durationMin} {localize(locale, "min", "دقيقة")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <CompleteButton
                        lectureId={l.id}
                        moduleSlug={moduleSlug}
                        completed={l.completed}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
