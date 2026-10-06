"use client";

import { CalendarDays } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-provider";

export function AcademicYearSelector({ years, value }: { years: number[]; value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLocale();

  if (!years.length) return null;

  function change(next: number) {
    document.cookie = `horus_study_year=${next}; path=/; max-age=31536000; samesite=lax`;
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(next));
    router.push(`${pathname}?${params.toString()}`);
    router.refresh();
  }

  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm">
      <CalendarDays className="h-4 w-4 text-primary" />
      <span className="sr-only">{t("Academic year", "السنة الدراسية")}</span>
      <select
        value={value}
        onChange={(event) => change(Number(event.target.value))}
        className="bg-transparent font-medium outline-none"
        aria-label={t("Select academic year", "اختر السنة الدراسية")}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {t(`Academic year ${year}`, `السنة الدراسية ${year}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
