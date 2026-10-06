"use client";

import { BarChart3, ListChecks, TimerOff, Target, Gauge } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { BarChart, EmptyState, KpiCard, Panel, Spinner, ErrorBox, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { QuizResponse } from "./types";

export function QuizTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<QuizResponse>("quiz", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const difficultyData = data.difficulty.map((d) => ({ label: d.difficulty, value: d.attempts }));

  return (
    <div className="space-y-6">
      {data.summary.total === 0 && (
        <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          لا توجد محاولات اختبار مسجلة في الفترة المحددة ({data.range}). الأرقام التالية تعرض 0 حتى تُسجل أول محاولة.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={BarChart3} label="إجمالي المحاولات" value={data.summary.total} color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={ListChecks} label="مكتملة" value={data.summary.completed} sub={`${data.summary.inProgress} جارية`} color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <KpiCard icon={TimerOff} label="متقطعة" value={data.summary.abandoned} sub="محاولات متروكة" color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
        <KpiCard icon={Target} label="متوسط النجاح" value={`${data.summary.avgScorePct}%`} sub="نسبة صحيحة/إجمالي" color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="المحاولات حسب الصعوبة" hint={`خلال ${data.range}`}>
          {data.difficulty.length === 0 ? (
            <EmptyState text="لا توجد بيانات صعوبة في هذه الفترة." />
          ) : (
            <BarChart data={difficultyData} empty="لا توجد بيانات." />
          )}
        </Panel>

        <Panel title="الأداء حسب الموديول" hint="محاولات مكتملة وعدد الطلاب">
          {data.perModule.length === 0 ? (
            <EmptyState text="لا يوجد نشاط اختبارات في هذه الفترة." />
          ) : (
            <BarChart data={data.perModule.map((m) => ({ label: m.name, value: m.attempts }))} empty="لا توجد بيانات." />
          )}
        </Panel>
      </div>

      <Panel title="تفاصيل الموديولات" hint="متوسط النجاح بالنسب المئوية">
        {data.perModule.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد بيانات.</p>
        ) : (
          <TableShell
            cols={[
              { key: "module", label: "الموديول" },
              { key: "attempts", label: "محاولات", className: "text-center" },
              { key: "students", label: "طلاب", className: "text-center" },
              { key: "avg", label: "متوسط النجاح", className: "text-center" },
            ]}
          >
            {data.perModule.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2.5 font-medium">{m.name}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.attempts}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.students}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className="inline-flex items-center gap-1 text-sm tabular-nums">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                    {m.avgPct}%
                  </span>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>
    </div>
  );
}