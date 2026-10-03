import { Search } from "lucide-react";
import { requireUser } from "@/shared/session";
import { Navigation } from "@/components/navigation";
import { StudySearch } from "@/components/study-search";
import { getLocale, localize } from "@/shared/locale";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const params = await searchParams;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation user={{ name: session.user.name, email: session.user.email }} isAdmin={session.user.role === "admin"} />
      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-start gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Search className="h-5 w-5" /></div>
            <div>
              <h1 className="text-3xl font-bold">{t("Study search", "بحث دراسي")}</h1>
              <p className="mt-1 text-muted-foreground">{t("Find concepts in the lectures you can access.", "ابحث داخل المحاضرات التي يمكنك الوصول إليها.")}</p>
            </div>
          </div>
          <StudySearch initialQuery={params.q ?? ""} />
        </div>
      </main>
    </div>
  );
}
