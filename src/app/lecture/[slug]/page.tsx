import Link from "next/link";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireUser } from "@/shared/session";
import { getLectureBySlug } from "@/features/curriculum/queries";
import { getBankForLecture, getBankForModule } from "@/features/practice/queries";
import { TutorChat } from "@/components/tutor-chat";
import { MarkdownContent } from "@/components/markdown-content";
import { Navigation } from "@/components/navigation";
import { Clock, BookOpen, FileText, Lock, MessageCircle, CheckCircle2, Brain, Lightbulb, ClipboardCheck, AlertCircle } from "lucide-react";
import { CompleteButton } from "@/components/complete-button";
import { PdfViewer } from "@/components/pdf-viewer";
import { MindMap } from "@/components/mind-map";
import { getLectureAids } from "@/features/curriculum/lecture-aids";
import { LectureNotes } from "@/components/lecture-notes";
import { db } from "@/shared/db";
import { lectureProgress } from "@/features/curriculum/schema";
import { and, eq } from "drizzle-orm";
import { getLocale, localize } from "@/shared/locale";
import { getAccessibleLecture } from "@/features/access/learning-access";

export default async function LecturePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const lectureRow = await getLectureBySlug(slug);
  if (!lectureRow) notFound();

  const moduleName = lectureRow.module?.name ?? t("Module", "الموديول");
  const isFree = lectureRow.module?.isFree ?? true;
  const lectureAccess = await getAccessibleLecture(session.user, lectureRow.id, { allowPreview: true });
  const access = lectureAccess.ok;
  const isPreview = lectureAccess.ok && lectureAccess.access === "preview";

  // Check if lecture is completed
  const progressRow = await db.query.lectureProgress.findFirst({
    where: and(
      eq(lectureProgress.userId, session.user.id),
      eq(lectureProgress.lectureId, lectureRow.id)
    ),
  });
  const isCompleted = !!progressRow;
  // A shared source book is not a lecture. Until its exact page boundaries are
  // reviewed, never show students an arbitrary first page from that book.
  const hasVerifiedPdfSegment = Boolean(
    lectureRow.pdfFile &&
      lectureRow.pdfPageStart &&
      lectureRow.pdfPageEnd &&
      lectureRow.pdfPageEnd >= lectureRow.pdfPageStart,
  );

  // Find quiz bank for this lecture (lecture-specific or module-wide fallback)
  const lectureBank = await getBankForLecture(lectureRow.id);
  const moduleBank = !lectureBank && lectureRow.moduleId
    ? await getBankForModule(lectureRow.moduleId)
    : null;
  const quizBank = lectureBank ?? moduleBank;

  const aids = getLectureAids({

    title: lectureRow.title,

    content: lectureRow.content ?? null,

    summaryJson: lectureRow.summaryJson ?? null,

    mindmapJson: (lectureRow.mindmapJson ?? null) as never,

  });

  const derivedSummary = aids.summary;

  const lectureMindMap = aids.mindMap;

  const aidsDerived = aids.derived;


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
              {t("Curriculum", "المنهج")}
            </Link>
            <span>/</span>
            {lectureRow.module && (
              <>
                <Link
                  href={`/curriculum/${lectureRow.module.slug}`}
                  className="hover:text-foreground"
                >
                  {moduleName}
                </Link>
                <span>/</span>
              </>
            )}
            <span className="text-foreground">{lectureRow.title}</span>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{lectureRow.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <BookOpen className="h-3 w-3" />
                {moduleName}
              </span>
              {lectureRow.subject ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {lectureRow.subject}
                </span>
              ) : null}
              {lectureRow.kind ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {lectureRow.kind === "lecture"
                    ? t("Lecture", "محاضرة")
                    : lectureRow.kind === "seminar"
                      ? t("Seminar", "سيمينار")
                      : t("Practical", "عملي")}
                </span>
              ) : null}
              {lectureRow.durationMin ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t(`${lectureRow.durationMin} min`, `${lectureRow.durationMin} دقيقة`)}
                </span>
              ) : null}
              {!isFree && !access ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600">
                  <Lock className="h-3 w-3" />
                  {t("Locked content", "محتوى مدفوع")}
                </span>
              ) : null}
              {isPreview && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
                  <BookOpen className="h-3 w-3" />
                  {t("Free preview", "معاينة مجانية")}
                </span>
              )}
              {isCompleted && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("Completed", "مكتمل")}
                </span>
              )}
            </div>
            {access && (
              <div className="mt-4">
                <CompleteButton
                  lectureId={lectureRow.id}
                  moduleSlug={lectureRow.module?.slug ?? ""}
                  completed={isCompleted}
                />
              </div>
            )}
          </div>

          {!access ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20">
              <Lock className="mx-auto mb-4 h-12 w-12 text-amber-400" />
              <h2 className="mb-2 text-xl font-semibold">
                {t("This lecture is locked", "هذه المحاضرة مدفوعة")}
              </h2>
              <p className="mb-6 text-muted-foreground">
                {t("Purchase the module or term to unlock this lecture and its study tutor.", "اشترِ الموديول أو الترم لفتح محتوى هذه المحاضرة والمعلم الذكي.")}
              </p>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("View plans", "عرض الأسعار والاشتراك")}
              </Link>
            </div>
          ) : (
            <>
              {/* PDF Viewer */}
              {hasVerifiedPdfSegment ? (
                <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <h2 className="font-semibold">{t("Original file (PDF)", "الملف الأصلي (PDF)")}</h2>
                  </div>
                  <PdfViewer
                    lectureId={lectureRow.id}
                    title={lectureRow.title}
                    pageStart={lectureRow.pdfPageStart}
                    pageEnd={lectureRow.pdfPageEnd}
                  />
                </div>
              ) : lectureRow.pdfFile ? (
                <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950/20">
                  <div className="mb-2 flex items-center gap-2 text-amber-800 dark:text-amber-300">
                    <AlertCircle className="h-5 w-5" />
                    <h2 className="font-semibold">{t("File under review", "الملف قيد المراجعة")}</h2>
                  </div>
                  <p className="text-sm leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                    {t("We are verifying this lecture's exact pages in the source file to avoid showing material from another lecture.", "نراجع الآن صفحات هذه المحاضرة داخل الملف المجمّع. لن نعرض الكتاب الكامل أو محتوى محاضرة أخرى بالخطأ.")}
                  </p>
                </div>
              ) : null}

              {/* Content */}
              {lectureRow.content ? (
                <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-muted-foreground" />
                    <h2 className="font-semibold">{t("Lecture text", "المحتوى النصي")}</h2>
                  </div>
                  <div className="max-h-[50rem] overflow-auto">
                    <MarkdownContent content={lectureRow.content} />
                  </div>
                </div>
              ) : (
                <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-muted-foreground" />
                    <h2 className="font-semibold">{t("Content", "المحتوى")}</h2>
                  </div>
                  <p className="leading-relaxed text-muted-foreground">
                    {lectureRow.summary ??
                      t("The complete lecture content is available in the original file above.", "المحتوى الكامل لهذه المحاضرة متاح في الملف الأصلي أعلاه.")}
                  </p>
                </div>
              )}

              {/* Summary card image (generated by scripts/build-study-assets.mjs) */}
              {existsSync(join(process.cwd(), "public", "study-cards", `${slug}.svg`)) ? (
                <div className="mb-6 overflow-hidden rounded-2xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/content/study-card/${lectureRow.id}`}
                    alt={t(`Summary of ${lectureRow.title}`, `ملخص ${lectureRow.title}`)}
                    className="w-full"
                  />
                </div>
              ) : null}

              {/* Summary */}
              {derivedSummary ? (
                <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    <h2 className="font-bold text-primary">{t("Lecture summary", "ملخص المحاضرة")}</h2>
                    {derivedSummary ? (
                      <span className="ms-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                        {t("from lecture text", "من نص المحاضرة")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mb-4 text-sm leading-relaxed text-foreground">{derivedSummary.overview}</p>

                  {derivedSummary.keyConcepts.length > 0 ? (
                    <div className="mb-4">
                      <h3 className="mb-2 text-sm font-semibold">{t("Key concepts", "المفاهيم الأساسية")}</h3>
                      <ul className="space-y-2">
                        {derivedSummary.keyConcepts.map((c) => (
                          <li key={c.term} className="rounded-lg bg-background/60 p-2 text-sm">
                            <span className="font-semibold text-foreground">{c.term}</span>
                            <span className="ms-2 text-muted-foreground">{c.meaning}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {derivedSummary.causes.length > 0 ? (
                    <div className="mb-4">
                      <h3 className="mb-2 text-sm font-semibold">{t("Causes & effects", "الأسباب والنتائج")}</h3>
                      <ul className="space-y-1.5">
                        {derivedSummary.causes.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span><span className="font-medium text-foreground">{c.cause}</span> &rarr; {c.effect}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {derivedSummary.comparisons.length > 0 ? (
                    <div className="mb-4">
                      <h3 className="mb-2 text-sm font-semibold">{t("Comparisons", "مقارنات")}</h3>
                      <ul className="space-y-1.5">
                        {derivedSummary.comparisons.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span><span className="font-medium text-foreground">{c.a}</span> vs {c.b}{c.note ? ` — ${c.note}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {derivedSummary.classifications.length > 0 ? (
                    <div className="mb-4">
                      <h3 className="mb-2 text-sm font-semibold">{t("Classifications", "التصنيفات")}</h3>
                      <ul className="space-y-1.5">
                        {derivedSummary.classifications.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span><span className="font-medium text-foreground">{c.group}</span>: {c.members}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {derivedSummary.takeaways.length > 0 ? (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-amber-600">{t("Takeaways", "أهم ما يجب تذكره")}</h3>
                      <ul className="space-y-1.5">
                        {derivedSummary.takeaways.map((tk, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            {tk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : lectureRow.summaryJson ? (
                <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    <h2 className="font-bold text-primary">{t("Lecture summary", "ملخص المحاضرة")}</h2>
                  </div>
                  <p className="mb-4 text-sm leading-relaxed text-foreground">
                    {lectureRow.summaryJson.overview}
                  </p>
                  {lectureRow.summaryJson.keyPoints?.length > 0 ? (
                    <div className="mb-4">
                      <h3 className="mb-2 text-sm font-semibold text-foreground">{t("Key points", "النقاط الرئيسية")}</h3>
                      <ul className="space-y-1.5">
                        {lectureRow.summaryJson.keyPoints.map((point, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {lectureRow.summaryJson.clinicalPearls?.length > 0 ? (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-amber-600">{t("Clinical pearls", "لؤلؤات سريرية")}</h3>
                      <ul className="space-y-1.5">
                        {lectureRow.summaryJson.clinicalPearls.map((pearl, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            {pearl}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Mind Map */}
              {lectureMindMap ? (
                <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Brain className="h-5 w-5 text-muted-foreground" />
                    <h2 className="font-semibold">{t("Mind map", "خريطة ذهنية")}</h2>
                    {aidsDerived ? (
                      <span className="ms-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t("built from this lecture", "مبنية من هذه المحاضرة")}
                      </span>
                    ) : null}
                  </div>
                  <MindMap data={lectureMindMap} />
                </div>
              ) : null}

              {/* Quiz Section */}
              {quizBank ? (
                <div className="mb-6 rounded-2xl border-2 border-primary/20 bg-primary/5 p-6">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <ClipboardCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h2 className="font-semibold">{t("Test your knowledge", "اختبر معلوماتك")}</h2>
                      <p className="text-sm text-muted-foreground">
                        {t("Test your understanding after reviewing this lecture.", "اختبر فهمك لمحتوى هذا الموديول بعد قراءة المحاضرة.")}
                      </p>
                    </div>
                    <Link
                      href={`/quiz/${quizBank.slug}`}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      {t("Start quiz", "ابدأ الاختبار")}
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <h2 className="font-semibold">{t("Quiz", "اختبار")}</h2>
                      <p className="text-sm text-muted-foreground">
                        {t("No quiz questions are available for this module yet.", "لا توجد أسئلة اختبار لهذا الموديول بعد.")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6">
                <LectureNotes lectureId={lectureRow.id} />
              </div>

              {/* AI Tutor */}
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-muted-foreground" />
                  <h2 className="font-semibold">{t("Study tutor", "المعلم الذكي (AI Tutor)")}</h2>
                </div>
                <TutorChat lectureId={lectureRow.id} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
