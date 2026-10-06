"use client";

import { Download, History, Search } from "lucide-react";
import { useState } from "react";
import { useAdminData, downloadCsv, formatDate, AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from "./use-admin-data";
import { Badge, EmptyState, Pagination, Panel, Spinner, ErrorBox, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { AuditResponse } from "./types";

export function AuditTab({ range }: { range: RangeValue }) {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, loading, error } = useAdminData<AuditResponse>(
    "audit",
    { range, action: action || undefined, entityType: entityType || undefined, search: search || undefined, page },
    [action, entityType, search, page],
  );

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Panel title="سجل التدقيق (audit_log)" hint="فقط للمسؤولين — قراءة فقط" actions={
        <button className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => void downloadCsv("audit", { range, action: action || undefined, entityType: entityType || undefined, search: search || undefined })}>
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      }>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">كل الأفعال</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">كل الكيانات</option>
            {Object.entries(AUDIT_ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input className="w-56 rounded-lg border border-border bg-background py-1 ps-7 pe-2 text-xs" placeholder="بحث بالاسم أو الكيان..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        {data.logs.length === 0 ? (
          <EmptyState text="لا توجد سجلات مطابقة." />
        ) : (
          <>
            <TableShell
              cols={[
                { key: "created", label: "التاريخ" },
                { key: "user", label: "المستخدم" },
                { key: "action", label: "الفعل" },
                { key: "entity", label: "الكيان" },
              ]}
            >
              {data.logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-xs tabular-nums whitespace-nowrap">{formatDate(l.createdAt)}</td>
                  <td className="px-4 py-2.5 text-sm font-medium">{l.userName ?? l.userId}</td>
                  <td className="px-4 py-2.5"><Badge tone={l.action === "delete" ? "red" : l.action === "create" ? "emerald" : "blue"}>{AUDIT_ACTION_LABELS[l.action] ?? l.action}</Badge></td>
                  <td className="px-4 py-2.5">
                    <p className="text-sm">{l.entityName ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{AUDIT_ENTITY_LABELS[l.entityType ?? ""] ?? l.entityType ?? ""}{l.entityId ? ` · ${l.entityId}` : ""}</p>
                  </td>
                </tr>
              ))}
            </TableShell>
            <Pagination page={data.page} totalPages={Math.ceil(data.total / data.limit)} total={data.total} onChange={setPage} />
          </>
        )}
      </Panel>

      {data.summary.length > 0 && (
        <Panel title="ملخص موجز" hint="توزيع الأحداث حسب الفعل">
          <div className="flex flex-wrap gap-3 p-4">
            {data.summary.map((s) => (
              <div key={s.action} className="rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">{AUDIT_ACTION_LABELS[s.action] ?? s.action}</p>
                <p className="text-lg font-semibold tabular-nums">{s.total.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        سجل التدقيق يُكتب آلياً عند تعديل بنية المنهج (وحدات، محاضرات، جامعات، كليات، برامج، سنوات، أترام) والاشتراكات — قراءة فقط هنا.
      </p>
    </div>
  );
}