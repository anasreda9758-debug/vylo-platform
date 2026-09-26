"use client";

import { useState } from "react";
import { Download, AlertTriangle, CreditCard, CircleCheck, CircleX } from "lucide-react";
import { useAdminData, downloadCsv, formatDate } from "./use-admin-data";
import { Badge, ErrorBox, Panel, Pagination, Spinner, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { SubscriptionsResponse } from "./types";

export function SubscriptionsTab({ range }: { range: RangeValue }) {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData<SubscriptionsResponse>(
    "subscriptions",
    { range, status: status === "all" ? undefined : status, search, page },
    [status, search, page],
  );

  const action = async (userId: string, planId: string | null, isActivate: boolean) => {
    setBusy(`${userId}:${planId ?? ""}:${isActivate}`);
    setMessage(null);
    const res = await fetch("/api/admin/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: isActivate ? "activate" : "deactivate", userId, planId: planId ?? undefined }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(body.error ?? "فشل تنفيذ العملية");
    } else {
      setMessage(isActivate ? "تم تفعيل الاشتراك." : "تم إلغاء تفعيل الاشتراك.");
      void reload();
    }
    setBusy(null);
  };

  const [expiring, setExpiring] = useState<{ userEmail: string; userName: string; planName: string | null; expiresAt: string }[] | null>(null);
  const [showExpiring, setShowExpiring] = useState(false);
  const loadExpiring = async () => {
    const res = await fetch("/api/admin/analytics?view=expiring&days=7");
    if (res.ok) {
      const body = (await res.json()) as { list: typeof expiring };
      setExpiring(body.list ?? []);
      setShowExpiring(true);
    }
  };

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="grace">مهلة السماح</option>
          <option value="expired">منتهي</option>
          <option value="cancelled">ملغي</option>
        </select>
        <input
          className="w-64 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="بحث بالاسم أو البريد..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
          onClick={() => void downloadCsv("subscriptions", { status: status === "all" ? undefined : status, search })}
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
          onClick={() => void loadExpiring()}
        >
          <AlertTriangle className="h-4 w-4" />
          اشتراكات تنتهي غضون 7 أيام
        </button>
      </div>

      {message && <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{message}</p>}

      {showExpiring && expiring && (
        <Panel title="اشتراكات تنتهي خلال 7 أيام" actions={
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowExpiring(false)}>إخفاء</button>
        }>
          {expiring.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">لا توجد اشتراكات تنتهي خلال 7 أيام.</p>
          ) : (
            <div className="divide-y divide-border">
              {expiring.map((e) => (
                <div key={e.userEmail} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{e.userName}</span>
                    <span className="mx-2 text-xs text-muted-foreground">{e.userEmail}</span>
                    <span className="text-xs text-muted-foreground">{e.planName ?? "—"}</span>
                  </div>
                  <span className="text-xs text-amber-600">{formatDate(e.expiresAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {data.subscriptions.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">لا توجد اشتراكات مطابقة.</p>
        ) : (
          <>
            <TableShell
              cols={[
                { key: "user", label: "المستخدم" },
                { key: "plan", label: "الخطة" },
                { key: "scope", label: "النطاق" },
                { key: "status", label: "الحالة", className: "text-center" },
                { key: "valid", label: "الصلاحية" },
                { key: "actions", label: "إجراءات", className: "text-center" },
              ]}
            >
              {data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium">{s.userName}</p>
                    <p className="text-xs text-muted-foreground">{s.userEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">{s.planName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.planScope ?? "—"}
                    {s.planScopeRef ? ` (${s.planScopeRef})` : ""}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={s.status === "active" ? "emerald" : s.status === "grace" ? "amber" : s.status === "expired" ? "red" : "muted"}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <p>{formatDate(s.startsAt)} ← {formatDate(s.expiresAt)}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="inline-flex gap-1">
                      {s.status !== "active" ? (
                        <button
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                          disabled={busy !== null}
                          onClick={() => void action(s.userId, data.plans[0]?.id ?? "", true)}
                        >
                          <CircleCheck className="h-3.5 w-3.5" />
                          تفعيل
                        </button>
                      ) : (
                        <button
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-red-500 hover:bg-accent disabled:opacity-40"
                          disabled={busy !== null}
                          onClick={() => void action(s.userId, null, false)}
                        >
                          <CircleX className="h-3.5 w-3.5" />
                          إلغاء
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
            <Pagination page={data.page} totalPages={Math.ceil(data.total / data.limit)} total={data.total} onChange={setPage} />
          </>
        )}
      </div>

      <Panel title="الخطط المتاحة" hint="أسعار الخطط من قاعدة البيانات (لا تُعرض كإيرادات)">
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.scope}{p.scopeRef ? ` (${p.scopeRef})` : ""} · {p.durationDays} يوم
                </p>
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold tabular-nums">{p.priceEg.toLocaleString("ar-EG")} ج.م</p>
                <p className="text-[10px] text-muted-foreground">{p.active ? "نشطة" : "مخفية"}</p>
              </div>
            </div>
          ))}
          {data.plans.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-muted-foreground">
              لا توجد خطط أسعار مسجلة.
            </p>
          )}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <CreditCard className="inline h-3 w-3 me-1" />
          قيمة الاشتراكات النشطة تُحسب من أسعار الخطط فقط، وليست إيرادات مدفوعة.
        </p>
      </Panel>
    </div>
  );
}