import { requireUser } from "@/shared/session";
import { FlashcardDeck } from "@/components/flashcard-deck";
import { listLecturesForReview } from "@/features/review/queries";
import { Navigation } from "@/components/navigation";
import { Brain } from "lucide-react";
import { getLocale, localize } from "@/shared/locale";

export default async function FlashcardsPage() {
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
            <h1 className="text-3xl font-bold">{t("Flashcards", "البطاقات التعليمية")}</h1>
            <p className="mt-1 text-muted-foreground">
              {t("Spaced-repetition cards created from the actual lecture content.", "بطاقات SRS من محتوى المحاضرات الحقيقي — احفظ على المدى الطويل.")}
            </p>
          </div>

          {lectures.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <Brain className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">
                {t("No readable lecture content is available yet, or you need access to a module or term.", "لا توجد محاضرات بنص قابل للقراءة بعد — أو اشترك في موديول/ترم لفتح المحتوى.")}
              </p>
            </div>
          ) : (
            <FlashcardDeck lectures={lectures} />
          )}
        </div>
      </main>
    </div>
  );
}
