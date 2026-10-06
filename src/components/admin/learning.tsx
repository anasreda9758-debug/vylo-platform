"use client";

import { BookOpen, CheckCircle2, MousePointerClick, Layers, Stethoscope } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { DayBars, KpiCard, Panel, Spinner, ErrorBox } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { LearningSeries } from "./types";

export function LearningTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<LearningSeries>("learning", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const series = data.days;
  const hasData = data.totals.lectures + data.totals.quizzes + data.totals.practical + data.totals.flashcards + data.totals.cases > 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={CheckCircle2} label="محاضرات مكتملة" value={data.totals.lectures} color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={Layers} label="اختبارات مكتملة" value={data.totals.quizzes} color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
        <KpiCard icon={MousePointerClick} label="إجابات عملية" value={data.totals.practical} color="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40" />
        <KpiCard icon={BookOpen} label="مراجعات بطاقات" value={data.totals.flashcards} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
        <KpiCard icon={Stethoscope} label="تقويمات حالات" value={data.totals.cases} color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
      </div>

      <Panel title={`النشاط اليومي — ${data.range}`} hint="محاضرات مكتملة / اختبارات / إجابات عملية" className={undefined}>
        <div className="grid gap-4 lg:grid-cols-2" dir="rtl">
          <div>
            <h4 className="px-4 pt-3 text-xs font-medium text-muted-foreground">محاضرات مكتملة يومياً</h4>
            <DayBars days={series.map((d) => ({ day: d.day, value: d.lectures }))} color="bg-blue-500/70" empty={range === "today" ? "لا يوجد نشاط مسجل اليوم." : "لا يوجد نشاط مسجل في الفترة المحددة."} />
          </div>
          <div>
            <h4 className="px-4 pt-3 text-xs font-medium text-muted-foreground">اختبارات مكتملة يومياً</h4>
            <DayBars days={series.map((d) => ({ day: d.day, value: d.quizzes }))} color="bg-purple-500/70" empty={range === "today" ? "لا يوجد نشاط مسجل اليوم." : "لا يوجد نشاط مسجل في الفترة المحددة."} />
          </div>
        </div>
      </Panel>

      {!hasData && (
        <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          لا يوجد نشاط تعليمي مسجل في هذه الفترة. النشاط يوازي الأحداث الفعلية في قاعدة البيانات (إكمال محاضرات، اختبارات، إجابات عملية، مراجعات بطاقات، تقويمات حالات).
        </p>
      )}
    </div>
  );
}