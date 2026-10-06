import Link from "next/link";
import { requireUser } from "@/shared/session";
import { getDueFlashcards, getAllFlashcards } from "@/features/review/queries";
import { Navigation } from "@/components/navigation";
import { getLocale, localize } from "@/shared/locale";
import { FlashcardReview } from "@/components/flashcard-review";

export default async function FlashcardsAllPage() {
  const session = await requireUser();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const dueCards = await getDueFlashcards(session.user.id, 100);
  const allCards = await getAllFlashcards(session.user.id);

  // Transform to DueCard type for FlashcardReview
  const reviewCards = allCards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    lectureTitle: c.lecture?.title ?? null,
    dueDate: c.dueDate.toISOString(),
    intervalDays: c.intervalDays,
  }));

  const dueReviewCards = reviewCards.filter((c) => new Date(c.dueDate) <= new Date());

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Navigation user={{ name: session.user.name, email: session.user.email }} isAdmin={session.user.role === "admin"} />
      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{t("My Flashcards", "بطاقاتي التعليمية")}</h1>
            <p className="mt-1 text-muted-foreground">
              {t("All your flashcards — due and upcoming.", "كل بطاقاتك التعليمية — المستحقة والقادمة.")}
            </p>
          </div>

          <div className="mb-6 inline-flex rounded-xl border border-border bg-card p-1">
            <Link
              href="/flashcards"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t("Due now", "المستحقة الآن")}
            </Link>
            <Link
              href="/flashcards/all"
              className="rounded-lg px-3 py-2 text-sm font-medium bg-primary text-primary-foreground"
            >
              {t("All cards", "كل البطاقات")}
            </Link>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("Total cards", "إجمالي البطاقات")}</span>
              </div>
              <p className="text-2xl font-bold">{reviewCards.length}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("Due now", "مستحقة الآن")}</span>
              </div>
              <p className="text-2xl font-bold">{dueReviewCards.length}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("Upcoming", "قادمة")}</span>
              </div>
              <p className="text-2xl font-bold">{reviewCards.length - dueReviewCards.length}</p>
            </div>
          </div>

          <FlashcardReview cards={reviewCards} />
        </div>
      </main>
    </div>
  );
}