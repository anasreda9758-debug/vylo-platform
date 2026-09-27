import { requireUser } from "@/shared/session";
import { OspeSimulator } from "@/components/ospe-simulator";
import { ExamMode } from "@/components/exam-mode";
import { Navigation } from "@/components/navigation";
import { FileText, ClipboardList } from "lucide-react";
import { getLocale, localize } from "@/shared/locale";
import { getAccessibleOspeFolder } from "@/features/access/learning-access";
import { OSPE_PDF_REFERENCES } from "@/features/ospe/data";
import { db } from "@/shared/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { practicalTrack } from "@/features/practical/schema";
import { practicalTrackOspeStation } from "@/features/ospe/schema";
import { curriculumModule } from "@/features/curriculum/schema";
import { getOspeModuleAccess } from "@/features/ospe/queries";

export default async function OspePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const session = await requireUser();
  const locale = await getLocale();
  const { mode } = await searchParams;
  const isExamMode = mode === "exam";
  const accessiblePdfReferences = (
    await Promise.all(
      OSPE_PDF_REFERENCES.map(async (reference) => ({
        reference,
        access: await getAccessibleOspeFolder(session.user, reference.folder),
      })),
    )
  )
    .filter(({ access }) => access.ok)
    .map(({ reference }) => reference);
  const accessibleModuleSlugs = (await getOspeModuleAccess(session.user))
    .filter((module) => !module.locked)
    .map((module) => module.moduleSlug);
  const [approvedStations] = accessibleModuleSlugs.length > 0
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(practicalTrackOspeStation)
        .innerJoin(practicalTrack, eq(practicalTrackOspeStation.trackId, practicalTrack.id))
        .innerJoin(curriculumModule, eq(practicalTrack.moduleId, curriculumModule.id))
        .where(and(
          eq(practicalTrack.status, "PUBLISHED"),
          eq(practicalTrack.ospeEnabled, true),
          inArray(curriculumModule.slug, accessibleModuleSlugs),
        ))
    : [{ count: 0 }];
  const availableStationCount = Number(approvedStations?.count ?? 0);

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">
                {localize(locale, "OSPE", "OSPE")}
              </h1>
              {availableStationCount > 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {isExamMode
                    ? localize(locale, "Timed exam using approved practical stations.", "امتحان محدد الوقت باستخدام المحطات العملية المعتمدة.")
                    : localize(locale, "Review approved practical stations.", "راجع المحطات العملية المعتمدة.")}
                </p>
              ) : null}
            </div>
            {availableStationCount > 0 ? (
              <a
                href={isExamMode ? "/ospe" : "/ospe?mode=exam"}
                className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {isExamMode ? localize(locale, "Review mode", "وضع المراجعة") : localize(locale, "Exam mode", "وضع الامتحان")}
              </a>
            ) : null}
          </div>

          {availableStationCount === 0 ? (
            <div className="rounded-2xl ring-1 ring-foreground/10">
              <div className="rounded-t-2xl border-b border-border bg-card p-8 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <ClipboardList className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">
                  {localize(locale, "OSPE stations are not published yet", "محطات OSPE لم تُنشر بعد")}
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                  {localize(
                    locale,
                    "An OSPE station is built from practical questions that an administrator has reviewed and approved. Nothing has been approved for your modules yet, so there is nothing to attempt here.",
                    "تُبنى محطة OSPE من أسئلة عملية يراجعها المشرف ويعتمدها. لم يتم اعتماد أي سؤال لموديولاتك بعد، لذلك لا يوجد ما يمكن clippingsه هنا.",
                  )}
                </p>
                <div className="mx-auto mt-5 grid max-w-2xl gap-3 text-start sm:grid-cols-3">
                  {[
                    {
                      n: "1",
                      en: "Lectures & notes",
                      ar: "المحاضرات والملاحظات",
                      d: "Your study material stays available while stations are prepared.",
                      dAr: "تظل مواد الدراسة متاحة أثناء تجهيز المحطات.",
                    },
                    {
                      n: "2",
                      en: "Reviewed & approved",
                      ar: "مراجعة واعتماد",
                      d: "Each question is checked against its source before it can be used.",
                      dAr: "يتم التحقق من كل سؤال مقابل مصدره قبل استخدامه.",
                    },
                    {
                      n: "3",
                      en: "Stations go live",
                      ar: "نشر المحطات",
                      d: "Approved questions are grouped into timed stations for your module.",
                      dAr: "تُجمَّع الأسئلة المعتمدة في محطات محددة الوقت لموديولك.",
                    },
                  ].map((s) => (
                    <div key={s.n} className="rounded-xl border border-border bg-background p-3">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {s.n}
                      </span>
                      <p className="mt-2 text-sm font-semibold">{localize(locale, s.en, s.ar)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{localize(locale, s.d, s.dAr)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-b-2xl bg-card p-6">
                <p className="mb-3 text-sm font-semibold">
                  {localize(locale, "You can still practise today", "يمكنك التدريب اليوم")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <a
                    href="/review"
                    className="rounded-xl border border-border p-4 transition-colors hover:bg-accent"
                  >
                    <p className="text-sm font-semibold">{localize(locale, "Review your questions", "مراجعة أسئلتك")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {localize(locale, "Revisit wrong and bookmarked items from earlier sessions.", "راجع الأسئلة الخاطئة والمفضلة من جلسات سابقة.")}
                    </p>
                  </a>
                  <a
                    href="/quiz/ospe"
                    className="rounded-xl border border-border p-4 transition-colors hover:bg-accent"
                  >
                    <p className="text-sm font-semibold">{localize(locale, "OSPE question bank", "بنك أسئلة OSPE")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {localize(locale, "Browse the approved question bank by module.", "تصفح بنك الأسئلة المعتمد حسب الموديول.")}
                    </p>
                  </a>
                </div>
                {accessiblePdfReferences.length > 0 ? (
                  <a
                    href="#ospe-pdf-references"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    {localize(locale, "Open the OSPE reference PDFs below ↓", "افتح مراجع OSPE بالأسفل ↓")}
                  </a>
                ) : null}
              </div>
            </div>
          ) : isExamMode ? (
            <ExamMode availableStationCount={availableStationCount} />
          ) : (
            <OspeSimulator />
          )}

          {/* PDF References Section */}
          <details id="ospe-pdf-references" className="mt-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-bold">
              <FileText className="h-5 w-5 text-primary" />
              {localize(locale, "Reference PDFs", "ملفات PDF للمرجع")}
            </summary>
            <p className="mb-4 mt-4 text-sm text-muted-foreground">
              {localize(locale, "Resources available through your current module access.", "المصادر المتاحة حسب صلاحية الموديولات الحالية.")}
            </p>
            {accessiblePdfReferences.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {localize(locale, "No OSPE reference PDFs are available with your current access.", "لا توجد ملفات OSPE مرجعية متاحة بصلاحية حسابك الحالية.")}
              </p>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {accessiblePdfReferences.map((pdf) => (
                <a
                  key={pdf.file}
                  href={`/api/content/ospe/pdf?file=${encodeURIComponent(pdf.file)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <FileText className="h-4 w-4 shrink-0 text-red-500" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{pdf.name}</div>
                    <div className="text-xs text-muted-foreground">{pdf.size}</div>
                  </div>
                </a>
              ))}
            </div>
            )}
          </details>
        </div>
      </main>
    </div>
  );
}
