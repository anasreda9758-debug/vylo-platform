"use client";

import { MapPin, Timer, GraduationCap, CheckCircle2 } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { Badge, EmptyState, KpiCard, Panel, Spinner, ErrorBox, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { OspeResponse } from "./types";

export function OspeTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<OspeResponse>("ospe", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const examsTotal = data.exams.reduce((a, e) => a + e.total, 0);

  return (
    <div className="space-y-6">
      {data.stationsConfigured === 0 && (
        <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          0 محطة مهيأة — لم يتم إعداد أي محطة إجابة OSPE بعد. حتى تكوين المحطات، ستبقى بيانات الاختبارات فارغة.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard icon={MapPin} label="محطات مهيأة" value={data.stationsConfigured} sub="مفاتيح إجابة OSPE" color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <KpiCard icon={Timer} label="امتحانات OSPE" value={examsTotal} sub="إجمالي الجلسات" color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={GraduationCap} label="المسارات" value={data.tracks.length} sub="مسارات مرتبطة بالمحطات" color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="نتائج الامتحانات حسب الحالة" hint={`خلال ${data.range}`}>
          {data.exams.length === 0 ? (
            <EmptyState text="لا توجد امتحانات OSPE في هذه الفترة." />
          ) : (
            <TableShell
              cols={[
                { key: "status", label: "الحالة" },
                { key: "total", label: "العدد", className: "text-center" },
                { key: "avg", label: "متوسط الدرجة", className: "text-center" },
              ]}
            >
              {data.exams.map((e) => (
                <tr key={e.status}>
                  <td className="px-4 py-2.5 font-medium">{e.status}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{e.total}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{e.total > 0 ? `${e.avgPct}%` : "—"}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>

        <Panel title="المسارات وربط المحطات" hint="كل مسار يحدد عدد المحطات المرتبطة عبر مفاتيح الإجابة">
          {data.tracks.length === 0 ? (
            <EmptyState text="لا توجد مسارات مسجلة." />
          ) : (
            <TableShell
              cols={[
                { key: "track", label: "المسار" },
                { key: "status", label: "الحالة" },
                { key: "stations", label: "محطات", className: "text-center" },
                { key: "modes", label: "الأوضاع" },
              ]}
            >
              {data.tracks.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-medium">{t.displayNameAr ?? t.displayNameEn}</p>
                    <p className="text-xs text-muted-foreground">{t.subject}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={t.status === "APPROVED" ? "emerald" : t.status === "DRAFT" ? "amber" : "muted"}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{t.stationBindings}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {t.practiceEnabled && <span className="me-1 text-cyan-600">ممارسة</span>}
                    {t.ospeEnabled && <span className="text-purple-600"><CheckCircle2 className="inline h-3 w-3" /> OSPE</span>}
                    {!t.practiceEnabled && !t.ospeEnabled && "—"}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>
      </div>
    </div>
  );
}