import { requireUser } from "@/shared/session";
import { CaseStudio } from "@/components/case-studio";
import { listLecturesForReview } from "@/features/review/queries";
import { Navigation } from "@/components/navigation";
import { Stethoscope } from "lucide-react";
import { getLocale, localize } from "@/shared/locale";

export default async function CasesPage() {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const lectures = await listLecturesForReview(session.user);

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation
        user={{ name: session.user.name, email: session.user.email }}
        isAdmin={session.user.role === "admin"}
      />

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{t("Clinical cases", "الحالات السريرية")}</h1>
            <p className="mt-1 text-muted-foreground">
              {t("Work through a source-based clinical case and receive feedback.", "حل حالة سريرية مولّدة من محتوى المحاضرة واحصل على تقييم.")}
            </p>
          </div>

          {lectures.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <Stethoscope className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">
                {t("No readable lecture content is available yet, or you need access to a module or term.", "لا توجد محاضرات بنص قابل للقراءة بعد — أو اشترك في موديول/ترم لفتح المحتوى.")}
              </p>
            </div>
          ) : (
            <CaseStudio lectures={lectures} />
          )}
        </div>
      </main>
    </div>
  );
}
