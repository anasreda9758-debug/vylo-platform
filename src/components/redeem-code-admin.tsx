"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchAdminJson } from "@/components/admin/use-admin-data";

type Code = { id: string; code: string; internalLabel: string | null; rewardType: string; moduleId: string | null; academicPeriodId: string | null; active: boolean; usedCount: number; maxUses: number | null; expiresAt: string | null };
type Option = { id: string; name?: string; academicYear?: string; type?: string };

export function RedeemCodeAdmin() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [modules, setModules] = useState<Option[]>([]);
  const [periods, setPeriods] = useState<Option[]>([]);
  const [form, setForm] = useState({ count: "1", rewardType: "FREE_MODULE", rewardValue: "0", internalLabel: "", moduleId: "", academicPeriodId: "", maxUses: "1", maxUsesPerUser: "1" });
  const [generated, setGenerated] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await fetchAdminJson<{ codes: Code[]; modules: Option[]; periods: Option[] }>("/api/admin/redeem-codes");
      setCodes(data.codes); setModules(data.modules); setPeriods(data.periods);
    } catch (error) {
      setError(error instanceof Error ? error.message : "network_error");
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function generate() {
    setError(""); setGenerated([]);
    const response = await fetch("/api/admin/redeem-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to generate codes"); return; }
    setGenerated(data.codes.map((code: { code: string }) => code.code));
    await load();
  }

  async function toggle(code: Code) {
    await fetch("/api/admin/redeem-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: code.id, active: !code.active }) });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-4 font-semibold">Generate redeem codes</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input className="rounded border border-border bg-background px-3 py-2 text-sm" type="number" min={1} max={500} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} placeholder="Count" />
          <input className="rounded border border-border bg-background px-3 py-2 text-sm" value={form.internalLabel} onChange={(e) => setForm({ ...form, internalLabel: e.target.value })} placeholder="Internal label" />
          <select className="rounded border border-border bg-background px-3 py-2 text-sm" value={form.rewardType} onChange={(e) => setForm({ ...form, rewardType: e.target.value })}>
            <option value="FREE_MODULE">Free module</option><option value="FREE_FULL_TERM">Free full term</option><option value="PERCENTAGE_DISCOUNT">Percentage discount</option><option value="FIXED_EGP_DISCOUNT">Fixed EGP discount</option><option value="FREE_PURCHASE">Free purchase</option>
          </select>
          <input className="rounded border border-border bg-background px-3 py-2 text-sm" type="number" min={0} value={form.rewardValue} onChange={(e) => setForm({ ...form, rewardValue: e.target.value })} placeholder="Discount value" />
          {form.rewardType === "FREE_MODULE" && <select className="rounded border border-border bg-background px-3 py-2 text-sm" value={form.moduleId} onChange={(e) => setForm({ ...form, moduleId: e.target.value })}><option value="">Select module</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
          {form.rewardType === "FREE_FULL_TERM" && <select className="rounded border border-border bg-background px-3 py-2 text-sm" value={form.academicPeriodId} onChange={(e) => setForm({ ...form, academicPeriodId: e.target.value })}><option value="">Select term</option>{periods.filter((p) => p.type !== "SUMMER").map((p) => <option key={p.id} value={p.id}>{p.academicYear} · {p.type}</option>)}</select>}
          <input className="rounded border border-border bg-background px-3 py-2 text-sm" type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Max uses" />
          <input className="rounded border border-border bg-background px-3 py-2 text-sm" type="number" min={1} value={form.maxUsesPerUser} onChange={(e) => setForm({ ...form, maxUsesPerUser: e.target.value })} placeholder="Per user" />
        </div>
        <Button className="mt-4" onClick={() => void generate()}>Generate</Button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {generated.length > 0 && <pre className="mt-4 max-h-48 overflow-auto rounded bg-muted p-3 text-xs">{generated.join("\n")}</pre>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead><tr className="border-b border-border text-right"><th className="p-3">Code</th><th className="p-3">Label</th><th className="p-3">Reward</th><th className="p-3">Used / Limit</th><th className="p-3">Status</th><th className="p-3">Expiry</th><th className="p-3" /></tr></thead><tbody>{codes.map((code) => <tr key={code.id} className="border-b border-border"><td className="p-3 font-mono">{code.code}</td><td className="p-3">{code.internalLabel ?? "—"}</td><td className="p-3">{code.rewardType}</td><td className="p-3">{code.usedCount} / {code.maxUses ?? "∞"}</td><td className="p-3">{code.active ? "Active" : "Inactive"}</td><td className="p-3">{code.expiresAt ?? "—"}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => void toggle(code)}>{code.active ? "Deactivate" : "Activate"}</Button></td></tr>)}</tbody></table></div>
    </div>
  );
}
