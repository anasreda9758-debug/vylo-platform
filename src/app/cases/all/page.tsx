import Link from "next/link";
import { requireUser } from "@/shared/session";
import { listMyCases } from "@/features/review/queries";
import { Navigation } from "@/components/navigation";
import { getLocale, localize } from "@/shared/locale";

export default async function CasesAllPage() {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
const allCases = await listMyCases(session.user.id);
  
  // Pre-compute time boundaries once to avoid impure Date.now() during render
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation user={{ name: session.user.name, email: session.user.email }} isAdmin={session.user.role === "admin"} />
      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{t("My Cases", "حالاتي السريرية")}</h1>
            <p className="mt-1 text-muted-foreground">
              {t("All your clinical cases.", "كل حالاتك السريرية.")}
            </p>
          </div>

          <div className="mb-6 inline-flex rounded-xl border border-border bg-card p-1">
            <Link
              href="/cases"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t("Generate new", "توليد جديد")}
            </Link>
            <Link
              href="/cases/all"
              className="rounded-lg px-3 py-2 text-sm font-medium bg-primary text-primary-foreground"
            >
              {t("All cases", "جميع الحالات")}
            </Link>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("Total cases", "إجمالي الحالات")}</span>
              </div>
              <p className="text-2xl font-bold">{allCases.length}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("Recent (7 days)", "الأخيرة (7 أيام)")}</span>
              </div>
              <p className="text-2xl font-bold">{allCases.filter((c) => new Date(c.createdAt).getTime() > sevenDaysAgo).length}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("This month", "هذا الشهر")}</span>
              </div>
              <p className="text-2xl font-bold">{allCases.filter((c) => new Date(c.createdAt).getTime() > thirtyDaysAgo).length}</p>
            </div>
          </div>

          {allCases.length === 0 ? (
            <div className="rounded-xl bg-card p-10 text-center text-muted-foreground ring-1 ring-foreground/10">
              <p>{t("No cases yet. Generate your first case from a lecture.", "لا توجد حالات بعد. ولّد أول حالة من محاضرة.")}</p>
              <Link
                href="/cases"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <span>{t("Generate case", "توليد حالة")}</span>
              </Link>
            </div>
          ) : (
            <div className="grid gap-4">
              {allCases.map((c) => (
                <Link
                  key={c.id}
                  href={"/cases/" + c.id}
                  className="block rounded-xl bg-card p-5 ring-1 ring-foreground/10 hover:ring-2 hover:ring-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {c.lecture?.title ?? t("Clinical case", "حالة سريرية")}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">{c.caseText}</p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{t("Questions", "الأسئلة")}: {JSON.parse(c.questionsJson).length}</span>
                        <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                        {t("Generated", "مُولّدة")}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}