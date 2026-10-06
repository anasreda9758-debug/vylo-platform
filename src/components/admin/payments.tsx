"use client";

import { CreditCard, CircleDollarSign, Wallet, Ban } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { EmptyState, KpiCard, Panel, Spinner, ErrorBox, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { PaymentsResponse } from "./types";

export function PaymentsTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<PaymentsResponse>("payments", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const totalPayments = data.byStatus.reduce((a, s) => a + s.total, 0);
  const totalAmount = data.byStatus.reduce((a, s) => a + s.amountEg, 0);

  return (
    <div className="space-y-6">
      {!data.enabled && (
        <p className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
          <Ban className="h-4 w-4 text-red-500" />
          بوابة الدفع الإلكتروني غير مُفعّلة (تفتقر مفاتيح Paymob الثلاثة). تُعرض البيانات المسجلة فقط دون أي معاملات جديدة.
        </p>
      )}

      {totalPayments === 0 && (
        <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          لا توجد معاملات دفع مسجلة حتى الآن في قاعدة البيانات في هذه الفترة ({data.range}).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard icon={Wallet} label="إجمالي المعاملات" value={totalPayments} sub={`خلال ${data.range}`} color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={CircleDollarSign} label="إجمالي المبالغ" value={`${totalAmount.toLocaleString("ar-EG")} ج.م`} sub="من جدول payment (amount_eg)" color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <KpiCard icon={CreditCard} label="طريقة الدفع" value={data.byMethod[0]?.method ?? "—"} sub={data.byMethod[0] ? `${data.byMethod[0].total} معاملة` : "لا وكلاء"} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="المعاملات حسب الحالة" hint="الحالات الفعلية من جدول payment">
          {data.byStatus.length === 0 ? (
            <EmptyState text="لا توجد معاملات مسجلة." />
          ) : (
            <TableShell
              cols={[
                { key: "status", label: "الحالة" },
                { key: "total", label: "العدد", className: "text-center" },
                { key: "amount", label: "المبلغ (ج.م)", className: "text-center" },
              ]}
            >
              {data.byStatus.map((s) => (
                <tr key={s.status}>
                  <td className="px-4 py-2.5 font-medium">{s.status}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{s.total}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{s.amountEg.toLocaleString("ar-EG")}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>

        <Panel title="المعاملات حسب طريقة الدفع" hint={`خلال ${data.range}`}>
          {data.byMethod.length === 0 ? (
            <EmptyState text="لا توجد معاملات في هذه الفترة." />
          ) : (
            <TableShell
              cols={[
                { key: "method", label: "الطريقة" },
                { key: "total", label: "العدد", className: "text-center" },
                { key: "amount", label: "المبلغ (ج.م)", className: "text-center" },
              ]}
            >
              {data.byMethod.map((m) => (
                <tr key={m.method}>
                  <td className="px-4 py-2.5 font-medium">{m.method}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{m.total}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{m.amountEg.toLocaleString("ar-EG")}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </Panel>
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDollarSign className="h-3.5 w-3.5" />
        قيمة الاشتراكات النشطة تُحسب من أسعار الخطط المسجلة وليست إيرادات مدفوعة — العروض هنا من جدول payment الفعلي إن وُجد.
      </p>
    </div>
  );
}