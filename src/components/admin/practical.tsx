"use client";

import { LayoutGrid, FileQuestion, CheckCircle2, PenLine, Bookmark, AlertTriangle, UserCheck } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { KpiCard, Panel, Spinner, ErrorBox, TableShell, Badge } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { PracticalResponse } from "./types";

export function PracticalTab({ range, onNavigate }: { range: RangeValue; onNavigate: (tab: string) => void }) {
  const { data, loading, error } = useAdminData<PracticalResponse>("practical", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const questionsTotal = data.byStatus.reduce((a, s) => a + s.total, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={LayoutGrid} label="مسارات عملية" value={data.trackTotal} sub="إجمالي المسارات المكوّنة" color="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40" onClick={() => onNavigate("ospe")} />
        <KpiCard icon={FileQuestion} label="أسئلة عملية" value={questionsTotal} sub="مرتبطة بالمسارات" color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={UserCheck} label="إجابات في النطاق" value={data.submissions.total} sub={`${data.submissions.users} طالب`} color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <KpiCard icon={Bookmark} label="متتبَّع" value={data.progress.trackedRows} sub={`${data.progress.attempts} محاولة تدريب`} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="حالة المسارات" hint="المسار DRAFT غير مرئي للطلاب">
          {data.tracks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">لم يتم تكوين أي مسار عملي بعد.</p>
          ) : (
            <TableShell
              cols={[
                { key: "status", label: "الحالة" },
                { key: "total", label: "المسارات", className: "text-center" },
                { key: "practice", label: "ممارسة", className: "text-center" },
                { key: "ospe", label: "OSPE", className: "text-center" },
              ]}
            >
              {data.tracks.map((t) => (
                <tr key={t.status}>
                  <td className="px-4 py-2.5 font-medium">{t.status}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{t.total}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{t.practiceEnabled}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{t.ospeEnabled}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>

        <Panel title="حالة مراجعة الأسئلة" hint="DRAFT / NEEDS_REVIEW تحتاج قبول المسؤول">
          {data.byReview.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد أسئلة عملية بعد.</p>
          ) : (
            <TableShell
              cols={[
                { key: "status", label: "حالة المراجعة" },
                { key: "total", label: "العدد", className: "text-center" },
              ]}
            >
              {data.byReview.map((s) => (
                <tr key={s.status}>
                  <td className="px-4 py-2.5 font-medium">
                    {s.status === "APPROVED" ? <Badge tone="emerald">{s.status}</Badge> : s.status === "NEEDS_REVIEW" ? <Badge tone="amber">{s.status}</Badge> : <Badge tone="muted">{s.status}</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{s.total}</td>
                </tr>
              ))}
            </TableShell>
          )}
          {data.byReview.some((s) => s.status === "NEEDS_REVIEW" || s.status === "DRAFT") && (
            <p className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              توجد أسئلة لم تُعتمد — افتح صفحة تأليف العملي لمراجعتها وإضفاء الصور.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="حالة النشر" hint="توزيع الأسئلة حسب كيان الحالة">
          {data.byStatus.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد أسئلة.</p>
          ) : (
            <TableShell
              cols={[
                { key: "status", label: "الحالة" },
                { key: "total", label: "العدد", className: "text-center" },
              ]}
            >
              {data.byStatus.map((s) => (
                <tr key={s.status}>
                  <td className="px-4 py-2.5 font-medium">{s.status}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{s.total}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>

        <Panel title="بيانات التدريب" hint="من جدول تقدم الطلاب في التدريب العملي">
          {data.progress.attempts === 0 && data.progress.trackedRows === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا يوجد نشاط تدريب عملي مسجل.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4">
              {[
                { icon: CheckCircle2, label: "محاولات التدريب", value: data.progress.attempts },
                { icon: LayoutGrid, label: "صفوف متتبعة", value: data.progress.trackedRows },
                { icon: Bookmark, label: "معلّمة", value: data.progress.bookmarked },
                { icon: PenLine, label: "محددة كصعبة", value: data.progress.difficult },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-xl border border-border bg-background p-3">
                  <Icon className="mb-1 h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}