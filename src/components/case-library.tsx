"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useLocale } from "@/components/locale-provider";
import type { ReviewLecture } from "@/features/review/queries";

type CaseSummary = {
  id: string;
  caseText: string;
  questions: string[];
  lectureTitle: string | null;
  createdAt: string;
  evaluatedAt: string | null;
  score: number | null;
};

export function CaseLibrary({ cases }: { cases: CaseSummary[] }) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<"all" | "evaluated" | "in_progress">("all");
  const [filterLecture, setFilterLecture] = useState<string | "all">("all");

  const lectureTitles = useCallback(() => [...new Set(cases.map((c) => c.lectureTitle).filter(Boolean))], [cases]);

  const filteredCases = cases.filter((c) => {
    const isEvaluated = !!c.evaluatedAt;
    const matchesFilter = filter === "all" || (filter === "evaluated" && isEvaluated) || (filter === "in_progress" && !isEvaluated);
    const matchesLecture = filterLecture === "all" || c.lectureTitle === filterLecture;
    return matchesFilter && matchesLecture;
  });

  function renderCaseCard(c: typeof cases[0]) {
    const isEvaluated = !!c.evaluatedAt;
    const statusClass = isEvaluated
      ? "bg-emerald-500/10 text-emerald-600"
      : "bg-amber-500/10 text-amber-600";
    const statusText = isEvaluated
      ? t("Evaluated", "مقيّمة")
      : t("In progress", "قيد الإنجاز");

    return (
      <Link
        key={c.id}
        href={"/cases/" + c.id}
        className="block rounded-xl bg-card p-5 ring-1 ring-foreground/10 hover:ring-2 hover:ring-primary/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                {c.lectureTitle ?? t("Clinical case", "حالة سريرية")}
              </span>
              {c.evaluatedAt && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {t("Evaluated", "مقيّمة")}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">{c.caseText}</p>
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span>{t("Questions", "الأسئلة")}: {c.questions.length}</span>
              {c.evaluatedAt && (
                <div className="flex items-center gap-2">
                  <span>{t("Score", "الدرجة")}: {c.score}/100</span>
                  <span>{new Date(c.evaluatedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={["inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", isEvaluated ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"].join(" ")}>
              {isEvaluated ? t("Evaluated", "مقيّمة") : t("In progress", "قيد الإنجاز")}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "evaluated" | "in_progress")}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t("All", "الكل")}</option>
            <option value="evaluated">{t("Evaluated", "مقيّمة")}</option>
            <option value="in_progress">{t("In progress", "قيد الإنجاز")}</option>
          </select>
          <select
            value={filterLecture}
            onChange={(e) => setFilterLecture(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t("All lectures", "جميع المحاضرات")}</option>
            {lectureTitles().map((title) => (
              <option key={title} value={title!}>
                {title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Total cases", "إجمالي الحالات")}</span>
          </div>
          <p className="text-2xl font-bold">{filteredCases.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("Evaluated", "مقيّمة")}</span>
          </div>
          <p className="text-2xl font-bold">{filteredCases.filter((c) => c.evaluatedAt).length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("In progress", "قيد الإنجاز")}</span>
          </div>
          <p className="text-2xl font-bold">{filteredCases.filter((c) => !c.evaluatedAt).length}</p>
        </div>
      </div>

      {filteredCases.length === 0 ? (
        <div className="rounded-xl bg-card p-10 text-center text-muted-foreground ring-1 ring-foreground/10">
          {filter === "evaluated" ? (
            t("No evaluated cases yet.", "لا توجد حالات مقيّمة بعد.")
          ) : filter === "in_progress" ? (
            t("No cases in progress.", "لا توجد حالات قيد الإنجاز.")
          ) : (
            t("No cases found.", "لم يتم العثور على حالات.")
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredCases.map((c) => renderCaseCard(c))}
        </div>
      )}
    </div>
  );
}