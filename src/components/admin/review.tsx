"use client";

import { BookOpen, Stethoscope, SquareStack, ExternalLink, Bell } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { EmptyState, KpiCard, Panel, Spinner, ErrorBox, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { ReviewResponse } from "./types";

export function ReviewTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<ReviewResponse>("review", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {data.flashcards.total === 0 && data.cases.total === 0 && (
        <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          لا توجد بطاقات أو حالات سريرية بعد — المحتوى يظهر فور تسجيله من بيانات المراجعة الفعلية.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={BookOpen} label="بطاقات" value={data.flashcards.total} sub={`${data.flashcards.createdInRange} جديدة`} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
        <KpiCard icon={Bell} label="مستحقة الآن" value={data.flashcards.dueNow} sub="استحقاق مراجعة SRS" color="text-orange-600 bg-orange-50 dark:bg-orange-950/40" />
        <KpiCard icon={SquareStack} label="مراجعات بطاقات" value={data.flashcardReviews.reviews} sub={`${data.flashcardReviews.users} طالب`} color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={Stethoscope} label="حالات سريرية" value={data.cases.total} sub={`${data.cases.lecturesCovered} محاضرة تغطيها`} color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <KpiCard icon={ExternalLink} label="تقويمات حالات" value={data.caseEvaluations.inRange} sub={data.caseEvaluations.total > 0 ? `متوسط ${data.caseEvaluations.avgScore}/10` : "لا تقويمات بعد"} color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="البطاقات الأكثر استحقاقاً" hint="أعلى عدد بطاقات مستحقة لكل محاضرة">
          {data.mostDue.length === 0 ? (
            <EmptyState text="لا توجد بطاقات مستحقة حالياً." />
          ) : (
            <TableShell
              cols={[
                { key: "lecture", label: "المحاضرة" },
                { key: "module", label: "الموديول" },
                { key: "due", label: "مستحقة", className: "text-center" },
              ]}
            >
              {data.mostDue.map((m, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 font-medium">{m.lectureTitle}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.moduleName}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{m.dueCount}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>

        <Panel title="ملخص الحالات السريرية" hint={`خلال ${data.range}`}>
          {data.cases.total === 0 ? (
            <EmptyState text="لا توجد حالات سريرية بعد." />
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4">
              {[
                { icon: BookOpen, label: "إجمالي الحالات", value: data.cases.total },
                { icon: ExternalLink, label: "حالات جديدة", value: data.cases.createdInRange },
                { icon: Stethoscope, label: "محاضرات مغطاة", value: data.cases.lecturesCovered },
                { icon: SquareStack, label: "تقويمات في النطاق", value: data.caseEvaluations.inRange },
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