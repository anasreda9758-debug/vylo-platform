"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import type { ReviewLecture } from "@/features/review/queries";

type DueCard = {
  id: string;
  front: string;
  back: string;
  lectureTitle: string | null;
  dueDate: string;
  intervalDays: number;
};

export function FlashcardReview({ cards }: { cards: DueCard[] }) {
  const { t } = useLocale();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [filter, setFilter] = useState<"all" | "due" | "upcoming">("all");
  const [filterLecture, setFilterLecture] = useState<string | "all">("all");

  const lectureIds = useCallback(() => [...new Set(cards.map((c) => c.lectureTitle).filter(Boolean))], [cards]);

  const filteredCards = cards.filter((c) => {
    const now = new Date();
    const due = new Date(c.dueDate);
    const isDue = due <= now;
    const matchesFilter = filter === "all" || (filter === "due" && isDue) || (filter === "upcoming" && !isDue);
    const matchesLecture = filterLecture === "all" || c.lectureTitle === filterLecture;
    return matchesFilter && matchesLecture;
  });

  const loadDue = useCallback(async () => {
    const res = await fetch("/api/review/flashcards");
    const data = await res.json();
    if (data.cards) window.location.reload();
  }, []);

  async function rate(rating: "again" | "good" | "easy") {
    const card = filteredCards[index];
    if (!card) return;
    await fetch("/api/review/flashcards/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, rating }),
    });
    setRevealed(false);
    if (index + 1 >= filteredCards.length) {
      setIndex(0);
    } else {
      setIndex((i) => i + 1);
    }
  }

  const card = filteredCards[index];

  return (
    <div className="grid gap-6">
      {/* Filter Controls */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "due" | "upcoming")}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t("All", "الكل")}</option>
            <option value="due">{t("Due now", "المستحقة الآن")}</option>
            <option value="upcoming">{t("Upcoming", "القادمة")}</option>
          </select>
          <select
            value={filterLecture}
            onChange={(e) => setFilterLecture(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t("All lectures", "جميع المحاضرات")}</option>
            {lectureIds().map((title) => (
              <option key={title} value={title!}>
                {title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Total in view", "الإجمالي في العرض")}</span>
          </div>
          <p className="text-2xl font-bold">{filteredCards.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Due now", "مستحقة الآن")}</span>
          </div>
          <p className="text-2xl font-bold">{filteredCards.filter((c) => new Date(c.dueDate) <= new Date()).length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Upcoming", "القادمة")}</span>
          </div>
          <p className="text-2xl font-bold">{filteredCards.filter((c) => new Date(c.dueDate) > new Date()).length}</p>
        </div>
      </div>

      {filteredCards.length === 0 ? (
        <div className="rounded-xl bg-card p-10 text-center text-muted-foreground ring-1 ring-foreground/10">
          {filter === "due" ? (
            t("No flashcards are due today.", "لا بطاقات مستحقة اليوم.")
          ) : filter === "upcoming" ? (
            t("No upcoming flashcards.", "لا بطاقات قادمة.")
          ) : (
            t("No flashcards found.", "لا توجد بطاقات.")
          )}
        </div>
      ) : card ? (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="border-b px-5 py-3 text-sm text-muted-foreground">
            {card.lectureTitle} · {t(`Card ${index + 1} of ${filteredCards.length}`, `بطاقة ${index + 1} من ${filteredCards.length}`)}
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {new Date(card.dueDate) <= new Date() ? t("Due", "مستحقة") : t("Upcoming", "قادمة")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="block w-full cursor-pointer px-5 py-10 text-start"
          >
            <p dir="auto" className="text-2xl font-bold leading-relaxed">{card.front}</p>
            {revealed ? (
              <p dir="auto" className="mt-6 text-lg leading-relaxed text-muted-foreground">{card.back}</p>
            ) : (
              <p className="mt-6 text-sm text-primary">{t("Click to reveal the answer", "انقر لإظهار الإجابة")}</p>
            )}
          </button>
          {revealed ? (
            <div className="flex flex-wrap gap-3 border-t px-5 py-4">
              <Button variant="outline" onClick={() => rate("again")}>{t("Again (1 day)", "مرة أخرى (1 يوم)")}</Button>
              <Button variant="outline" onClick={() => rate("good")}>{t("Good (3 days)", "جيد (3 أيام)")}</Button>
              <Button variant="outline" onClick={() => rate("easy")}>{t("Easy (7 days)", "سهل (7 أيام)")}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {filteredCards.length > 0 && (
        <div className="flex justify-between gap-3 border-t pt-4">
          <Button variant="outline" disabled={index === 0} onClick={() => { setRevealed(false); setIndex((i) => i - 1); }}>
            {t("Previous", "السابق")}
          </Button>
          <Button variant="outline" disabled={index >= filteredCards.length - 1} onClick={() => { setRevealed(false); setIndex((i) => i + 1); }}>
            {t("Next", "التالي")}
          </Button>
        </div>
      )}
    </div>
  );
}