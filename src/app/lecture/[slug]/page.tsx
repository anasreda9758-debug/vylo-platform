import Link from "next/link";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireUser } from "@/shared/session";
import { getLectureBySlug } from "@/features/curriculum/queries";
import {
  getBankForLecture,
  getBankForModule,
} from "@/features/practice/queries";
import { TutorChat } from "@/components/tutor-chat";
import { MarkdownContent } from "@/components/markdown-content";
import {
  StudentShell,
  StudentPage,
  StudentHeader,
  studentLink,
} from "@/components/student-shell";
import { StudyWorkspace } from "@/components/study-workspace";
import {
  BookOpen,
  FileText,
  Brain,
  Lightbulb,
  ClipboardCheck,
  AlertCircle,
} from "lucide-react";
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
import { isModuleAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";

export default async function LecturePage({
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
  const t = (english: string, arabic: string) =>
    localize(locale, english, arabic);
  const lectureRow = await getLectureBySlug(slug);
  if (!lectureRow) notFound();
  if (!lectureRow.module || !(await isModuleAcademicallyVisible(session.user, lectureRow.module))) notFound();

  const moduleName = lectureRow.module?.name ?? t("Module", "الموديول");
  const lectureAccess = await getAccessibleLecture(
    session.user,
    lectureRow.id,
    { allowPreview: true },
  );
  const access = lectureAccess.ok;
  const isPreview = lectureAccess.ok && lectureAccess.access === "preview";

  // Check if lecture is completed
  const progressRow = await db.query.lectureProgress.findFirst({
    where: and(
      eq(lectureProgress.userId, session.user.id),
      eq(lectureProgress.lectureId, lectureRow.id),
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
  const moduleBank =
    !lectureBank && lectureRow.moduleId
      ? await getBankForModule(lectureRow.moduleId)
      : null;
  const quizBank = lectureBank ?? moduleBank;

  const aids = getLectureAids({
    title: lectureRow.title,

    moduleTitle: lectureRow.module?.name ?? undefined,

    content: lectureRow.content ?? null,

    summaryJson: lectureRow.summaryJson ?? null,

    mindmapJson: (lectureRow.mindmapJson ?? null) as never,
  });

  const derivedSummary = aids.summary;

  const lectureMindMap = aids.mindMap;

  const aidsDerived = aids.derived;

  return (
    <StudentShell user={session.user}>
      <StudentPage wide>
        <StudentHeader
          title={lectureRow.title}
          context={
            <Link
              href={
                lectureRow.module
                  ? `/curriculum/${lectureRow.module.slug}`
                  : "/curriculum"
              }
              className="hover:text-foreground"
            >
              {moduleName}
            </Link>
          }
          description={[
            lectureRow.subject,
            lectureRow.kind,
            lectureRow.durationMin
              ? `${lectureRow.durationMin} ${t("min", "دقيقة")}`
              : null,
            isPreview ? t("Free preview", "معاينة مجانية") : null,
            isCompleted ? t("Completed", "مكتملة") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          action={
            access ? (
              <CompleteButton
                lectureId={lectureRow.id}
                moduleSlug={lectureRow.module?.slug ?? ""}
                completed={isCompleted}
              />
            ) : undefined
          }
        />
        {!access ? (
          <section className="border-t pt-6">
            <h2 className="text-lg font-medium">
              {t("This lecture is locked", "هذه المحاضرة مقفلة")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "View plans to unlock this lecture and its study tools.",
                "اعرض الخطط لفتح هذه المحاضرة وأدواتها.",
              )}
            </p>
            <Link href="/pricing" className={studentLink}>
              {t("View plans", "عرض الخطط")}
            </Link>
          </section>
        ) : (
          <StudyWorkspace
            key={lectureRow.id}
            initialPanel={tool === "tutor" ? "tutor" : undefined}
            material={
              <>
                {/* PDF Viewer */}
                {hasVerifiedPdfSegment ? (
                  <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <h2 className="font-semibold">
                        {t("Original file (PDF)", "الملف الأصلي (PDF)")}
                      </h2>
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
                      <h2 className="font-semibold">
                        {t("File under review", "الملف قيد المراجعة")}
                      </h2>
                    </div>
                    <p className="text-sm leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                      {t(
                        "We are verifying this lecture's exact pages in the source file to avoid showing material from another lecture.",
                        "نراجع الآن صفحات هذه المحاضرة داخل الملف المجمّع. لن نعرض الكتاب الكامل أو محتوى محاضرة أخرى بالخطأ.",
                      )}
                    </p>
                  </div>
                ) : null}

                {!hasVerifiedPdfSegment && !lectureRow.pdfFile && (
                  <section className="rounded-xl border bg-card p-5">
                    <h2 className="mb-4 font-medium">
                      {t("Lecture material", "مادة المحاضرة")}
                    </h2>
                    {lectureRow.content ? (
                      <div dir="auto">
                        <MarkdownContent content={lectureRow.content} />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {lectureRow.summary ??
                          t(
                            "No source material is available yet. Return to your module for another lecture.",
                            "لا توجد مادة مصدر بعد. عد للموديول لاختيار محاضرة أخرى.",
                          )}
                      </p>
                    )}
                  </section>
                )}
              </>
            }
            panels={[
              {
                id: "outline",
                label: t("Source", "المصدر"),
                content: (
                  <>
                    <h2 className="mb-3 font-medium">
                      {t("Lecture source", "مصدر المحاضرة")}
                    </h2>
                    {/* Content */}
                    {lectureRow.content ? (
                      <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                        <div className="mb-4 flex items-center gap-2">
                          <BookOpen className="h-5 w-5 text-muted-foreground" />
                          <h2 className="font-semibold">
                            {t("Lecture text", "المحتوى النصي")}
                          </h2>
                        </div>
                        <div className="max-h-[50rem] overflow-auto">
                          <div dir="auto">
                            <MarkdownContent content={lectureRow.content} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                        <div className="mb-4 flex items-center gap-2">
                          <BookOpen className="h-5 w-5 text-muted-foreground" />
                          <h2 className="font-semibold">
                            {t("Content", "المحتوى")}
                          </h2>
                        </div>
                        <p className="leading-relaxed text-muted-foreground">
                          {lectureRow.summary ??
                            t(
                              "The complete lecture content is available in the original file above.",
                              "المحتوى الكامل لهذه المحاضرة متاح في الملف الأصلي أعلاه.",
                            )}
                        </p>
                      </div>
                    )}

                    <Link
                      href={
                        lectureRow.module
                          ? `/curriculum/${lectureRow.module.slug}`
                          : "/curriculum"
                      }
                      className={studentLink}
                    >
                      {t("Module outline", "محاضرات الموديول")}
                    </Link>
                  </>
                ),
              },
              {
                id: "summary",
                label: t("Summary", "الملخص"),
                content: (
                  <>
                    {/* Summary card image (generated by scripts/build-study-assets.mjs) */}
                    {existsSync(
                      join(
                        process.cwd(),
                        "public",
                        "study-cards",
                        `${slug}.svg`,
                      ),
                    ) ? (
                      <div className="mb-6 overflow-hidden rounded-2xl border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/content/study-card/${lectureRow.id}`}
                          alt={t(
                            `Summary of ${lectureRow.title}`,
                            `ملخص ${lectureRow.title}`,
                          )}
                          className="w-full"
                        />
                      </div>
                    ) : null}

                    {/* Summary */}
                    {derivedSummary ? (
                      <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-6">
                        <div className="mb-4 flex items-center gap-2">
                          <Lightbulb className="h-5 w-5 text-primary" />
                          <h2 className="font-bold text-primary">
                            {t("Lecture summary", "ملخص المحاضرة")}
                          </h2>
                          {derivedSummary ? (
                            <span className="ms-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                              {t("from lecture text", "من نص المحاضرة")}
                            </span>
                          ) : null}
                        </div>
                        <p
                          dir="auto"
                          className="mb-4 text-sm leading-relaxed text-foreground"
                        >
                          {derivedSummary.overview}
                        </p>

                        {derivedSummary.keyConcepts.length > 0 ? (
                          <div className="mb-4">
                            <h3 className="mb-2 text-sm font-semibold">
                              {t("Key concepts", "المفاهيم الأساسية")}
                            </h3>
                            <ul className="space-y-2">
                              {derivedSummary.keyConcepts.map((c) => (
                                <li
                                  key={c.term}
                                  className="rounded-lg bg-background/60 p-2 text-sm"
                                >
                                  <span className="font-semibold text-foreground">
                                    {c.term}
                                  </span>
                                  <span className="ms-2 text-muted-foreground">
                                    {c.meaning}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {derivedSummary.causes.length > 0 ? (
                          <div className="mb-4">
                            <h3 className="mb-2 text-sm font-semibold">
                              {t("Causes & effects", "الأسباب والنتائج")}
                            </h3>
                            <ul className="space-y-1.5">
                              {derivedSummary.causes.map((c, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                  <span>
                                    <span className="font-medium text-foreground">
                                      {c.cause}
                                    </span>{" "}
                                    &rarr; {c.effect}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {derivedSummary.comparisons.length > 0 ? (
                          <div className="mb-4">
                            <h3 className="mb-2 text-sm font-semibold">
                              {t("Comparisons", "مقارنات")}
                            </h3>
                            <ul className="space-y-1.5">
                              {derivedSummary.comparisons.map((c, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                  <span>
                                    <span className="font-medium text-foreground">
                                      {c.a}
                                    </span>{" "}
                                    vs {c.b}
                                    {c.note ? ` — ${c.note}` : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {derivedSummary.classifications.length > 0 ? (
                          <div className="mb-4">
                            <h3 className="mb-2 text-sm font-semibold">
                              {t("Classifications", "التصنيفات")}
                            </h3>
                            <ul className="space-y-1.5">
                              {derivedSummary.classifications.map((c, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                  <span>
                                    <span className="font-medium text-foreground">
                                      {c.group}
                                    </span>
                                    : {c.members}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {derivedSummary.takeaways.length > 0 ? (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold text-amber-600">
                              {t("Takeaways", "أهم ما يجب تذكره")}
                            </h3>
                            <ul className="space-y-1.5">
                              {derivedSummary.takeaways.map((tk, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                  {tk}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : !aidsDerived && lectureRow.summaryJson ? (
                      <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-6">
                        <div className="mb-4 flex items-center gap-2">
                          <Lightbulb className="h-5 w-5 text-primary" />
                          <h2 className="font-bold text-primary">
                            {t("Lecture summary", "ملخص المحاضرة")}
                          </h2>
                        </div>
                        <p className="mb-4 text-sm leading-relaxed text-foreground">
                          {lectureRow.summaryJson.overview}
                        </p>
                        {lectureRow.summaryJson.keyPoints?.length > 0 ? (
                          <div className="mb-4">
                            <h3 className="mb-2 text-sm font-semibold text-foreground">
                              {t("Key points", "النقاط الرئيسية")}
                            </h3>
                            <ul className="space-y-1.5">
                              {lectureRow.summaryJson.keyPoints.map(
                                (point, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                  >
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                    {point}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                        {lectureRow.summaryJson.clinicalPearls?.length > 0 ? (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold text-amber-600">
                              {t("Clinical pearls", "لؤلؤات سريرية")}
                            </h3>
                            <ul className="space-y-1.5">
                              {lectureRow.summaryJson.clinicalPearls.map(
                                (pearl, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                  >
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                    {pearl}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!derivedSummary && !lectureRow.summaryJson && (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "A summary is not available for this lecture yet. Use the source material or Ask VYLO.",
                          "ملخص هذه المحاضرة غير متاح بعد. استخدم المصدر أو اسأل VYLO.",
                        )}
                      </p>
                    )}
                  </>
                ),
              },
              {
                id: "map",
                label: t("Mind map", "الخريطة"),
                content: (
                  <>
                    {/* Mind Map */}
                    {lectureMindMap ? (
                      <div className="mb-6 rounded-2xl border border-border bg-card p-6">
                        <div className="mb-4 flex items-center gap-2">
                          <Brain className="h-5 w-5 text-muted-foreground" />
                          <h2 className="font-semibold">
                            {t("Mind map", "خريطة ذهنية")}
                          </h2>
                          {aidsDerived ? (
                            <span className="ms-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              {t(
                                "built from this lecture",
                                "مبنية من هذه المحاضرة",
                              )}
                            </span>
                          ) : null}
                        </div>
                        <MindMap data={lectureMindMap} />
                      </div>
                    ) : null}

                    {!lectureMindMap && (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "No mind map is available yet.",
                          "لا توجد خريطة ذهنية بعد.",
                        )}
                      </p>
                    )}
                  </>
                ),
              },
              {
                id: "tutor",
                label: t("Ask VYLO", "اسأل VYLO"),
                content: <TutorChat lectureId={lectureRow.id} />,
              },
              {
                id: "notes",
                label: t("Notes", "ملاحظات"),
                content: <LectureNotes lectureId={lectureRow.id} />,
              },
              {
                id: "practice",
                label: t("Practice", "تدريب"),
                content: (
                  <>
                    {/* Quiz Section */}
                    {quizBank ? (
                      <div className="mb-6 rounded-2xl border-2 border-primary/20 bg-primary/5 p-6">
                        <div className="flex items-center gap-3">
                          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                            <ClipboardCheck className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1">
                            <h2 className="font-semibold">
                              {t("Test your knowledge", "اختبر معلوماتك")}
                            </h2>
                            <p className="text-sm text-muted-foreground">
                              {t(
                                "Test your understanding after reviewing this lecture.",
                                "اختبر فهمك لمحتوى هذا الموديول بعد قراءة المحاضرة.",
                              )}
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
                            <h2 className="font-semibold">
                              {t("Quiz", "اختبار")}
                            </h2>
                            <p className="text-sm text-muted-foreground">
                              {t(
                                "No quiz questions are available for this module yet.",
                                "لا توجد أسئلة اختبار لهذا الموديول بعد.",
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <Link href="/flashcards" className={studentLink}>
                      {t("Open flashcards", "افتح البطاقات")}
                    </Link>
                  </>
                ),
              },
            ]}
          />
        )}
      </StudentPage>
    </StudentShell>
  );
}
