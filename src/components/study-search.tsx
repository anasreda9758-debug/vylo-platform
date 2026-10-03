"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

type Result = {
  text: string;
  lectureTitle: string;
  lectureSlug: string;
  moduleSlug: string;
};

export function StudySearch({ initialQuery = "" }: { initialQuery?: string }) {
  const { t } = useLocale();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await response.json().catch(() => ({ results: [] }));
      setResults(response.ok ? data.results ?? [] : []);
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search a medical term, concept, or lecture…", "ابحث عن مصطلح طبي أو مفهوم أو محاضرة…")}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
        <button type="submit" disabled={!query.trim() || busy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t("Search", "بحث")}
        </button>
      </form>

      {searched && results.length === 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          {t("No matching material was found in your accessible lectures.", "لم نجد مادة مطابقة داخل محاضراتك المتاحة.")}
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-6 space-y-3">
          {results.map((result, index) => (
            <li key={`${result.lectureSlug}-${index}`}>
              <Link href={`/lecture/${result.lectureSlug}`} className="group block rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold group-hover:text-primary">{result.lectureTitle}</p>
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{result.text}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
