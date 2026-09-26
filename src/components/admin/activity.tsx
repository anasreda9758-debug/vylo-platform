"use client";

import { Activity as ActivityIcon, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAdminData, formatDate, ACTIVITY_LABELS } from "./use-admin-data";
import { Panel, Spinner, ErrorBox, EmptyState } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { ActivityResponse } from "./types";

const TYPE_DOTS: Record<string, string> = {
  register: "bg-sky-500",
  lecture: "bg-blue-500",
  quiz: "bg-purple-500",
  practical: "bg-cyan-500",
  case_eval: "bg-emerald-500",
  subscription: "bg-amber-500",
  ospe_exam: "bg-fuchsia-500",
};

export function ActivityTab({ range }: { range: RangeValue }) {
  const [limit, setLimit] = useState(50);
  const { data, loading, error, reload } = useAdminData<ActivityResponse>("activity", { range, limit }, [limit]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const { events } = data;

  return (
    <div className="space-y-6">
      <Panel
        title={`مصدر الأحداث — ${data.range}`}
        hint="ترتيب تنازلي من اتحاد أحداث حقيقية: تسجيل، إكمال محاضرات، اختبارات، إجابات عملية، تقويم حالات، اشتراكات، OSPE"
        actions={
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
            <button className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => void reload()}>
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </button>
          </div>
        }
      >
        {events.length === 0 ? (
          <EmptyState text="لا توجد أحداث مسجلة في الفترة المحددة." />
        ) : (
          <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
            {events.map((e, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOTS[e.type] ?? "bg-muted"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{e.userName}</span>
                    <span className="mx-1.5 text-xs text-muted-foreground">{ACTIVITY_LABELS[e.type] ?? e.type}</span>
                  </p>
                  {e.title && <p className="truncate text-xs text-muted-foreground">{e.title}</p>}
                  {e.entity && <p className="text-[11px] text-muted-foreground/70">{e.entity}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatDate(e.ts)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-center gap-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <ActivityIcon className="h-3 w-3" />
          حد أقصى {limit} حدث — وسّع النطاق الزمني أو زد العدد للأحداث الأقدم.
        </p>
      </Panel>
    </div>
  );
}