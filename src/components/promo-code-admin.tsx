"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate, toDateTimeLocalValue } from "./admin/use-admin-data";

type Promo = {
  id: string;
  code: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FIXED_EGP";
  discountValue: number;
  appliesTo: "ANY" | "MODULE" | "SEMESTER";
  moduleId: string | null;
  academicPeriodId: string | null;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  redemptionCount?: number;
};

type Module = { id: string; name: string };
type Period = { id: string; academicYear: string; type: string };

const blank = {
  code: "",
  description: "",
  discountType: "PERCENTAGE",
  discountValue: "20",
  appliesTo: "ANY",
  moduleId: "",
  maxUses: "100",
  maxUsesPerUser: "1",
  startsAt: "",
  expiresAt: "",
  active: true,
  academicPeriodId: "",
};

export function PromoCodeAdmin() {
  const [codes, setCodes] = useState<Promo[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/admin/promo-codes");
    if (response.ok) {
      const data = await response.json();
      setCodes(data.codes);
      setModules(data.modules);
      setPeriods(data.periods);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function reset() {
    setForm({ ...blank });
    setEditingId(null);
    setError(null);
  }

  function edit(code: Promo) {
    setEditingId(code.id);
    setForm({
      code: code.code,
      description: code.description ?? "",
      discountType: code.discountType,
      discountValue: String(code.discountValue),
      appliesTo: code.appliesTo,
      moduleId: code.moduleId ?? "",
      maxUses: code.maxUses === null ? "" : String(code.maxUses),
      maxUsesPerUser: String(code.maxUsesPerUser),
      startsAt: toDateTimeLocalValue(code.startsAt),
      expiresAt: toDateTimeLocalValue(code.expiresAt),
      active: code.active,
      academicPeriodId: code.academicPeriodId ?? "",
    });
  }

  async function save() {
    setError(null);
    const response = await fetch("/api/admin/promo-codes", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, id: editingId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Unable to save code");
      return;
    }
    reset();
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-4 font-semibold">{editingId ? "تعديل كود خصم" : "إنشاء كود خصم"}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="وصف داخلي" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
            <option value="PERCENTAGE">نسبة مئوية</option>
            <option value="FIXED_EGP">جنيه ثابت</option>
          </select>
          <input type="number" min={0} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="قيمة الخصم" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}>
            <option value="ANY">أي منتج</option>
            <option value="MODULE">موديول</option>
            <option value="FULL_TERM">ترم كامل</option>
          </select>
          {form.appliesTo === "MODULE" && (
            <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.moduleId} onChange={(e) => setForm({ ...form, moduleId: e.target.value })}>
              <option value="">كل الموديولات</option>
              {modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
            </select>
          )}
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.academicPeriodId} onChange={(e) => setForm({ ...form, academicPeriodId: e.target.value })}>
            <option value="">كل الفترات</option>
            {periods.map((period) => <option key={period.id} value={period.id}>{period.academicYear} · {period.type}</option>)}
          </select>
          <input type="number" min={1} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="الحد الإجمالي" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          <input type="number" min={1} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="لكل مستخدم" value={form.maxUsesPerUser} onChange={(e) => setForm({ ...form, maxUsesPerUser: e.target.value })} />
          <input type="datetime-local" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          <input type="datetime-local" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button onClick={save}>{editingId ? "حفظ التعديل" : "إنشاء الكود"}</Button>
          {editingId && <Button variant="outline" onClick={reset}>إلغاء</Button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-right text-muted-foreground"><th className="p-3">Code</th><th className="p-3">Discount</th><th className="p-3">Scope</th><th className="p-3">Uses / Limit</th><th className="p-3">Redemptions</th><th className="p-3">Status</th><th className="p-3">Start</th><th className="p-3">Expiry</th><th className="p-3" /></tr></thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code.id} className="border-b border-border last:border-0">
                <td className="p-3 font-mono">{code.code}</td>
                <td className="p-3">{code.discountType === "PERCENTAGE" ? `${code.discountValue}%` : `${code.discountValue} EGP`}</td>
                <td className="p-3">{code.appliesTo}{code.moduleId ? ` · ${modules.find((m) => m.id === code.moduleId)?.name ?? ""}` : ""}</td>
                <td className="p-3">{code.usedCount} / {code.maxUses ?? "∞"} · {code.maxUsesPerUser}/user</td>
                <td className="p-3">{code.redemptionCount ?? 0}</td>
                <td className="p-3">{code.active ? "Active" : "Inactive"}</td>
                <td className="p-3">{formatDate(code.startsAt)}</td>
                <td className="p-3">{formatDate(code.expiresAt)}</td>
                <td className="p-3"><Button size="sm" variant="outline" onClick={() => edit(code)}>تعديل</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
