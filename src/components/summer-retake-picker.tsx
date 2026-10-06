"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type SummerModule = {
  id: string;
  name: string;
  studyYear: number;
  term: number;
};

export function SummerRetakePicker({
  modules,
  endsAt,
}: {
  modules: SummerModule[];
  endsAt: Date;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [preview, setPreview] = useState<{ discountAmountCents: number; finalPriceCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleModules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return modules.filter((module) => !normalized || module.name.toLowerCase().includes(normalized));
  }, [modules, query]);

  function toggle(moduleId: string) {
    setSelected((current) => current.includes(moduleId)
      ? current.filter((id) => id !== moduleId)
      : [...current, moduleId]);
    setPreview(null);
    setError(null);
  }

  async function calculate() {
    setError(null);
    const response = await fetch("/api/billing/summer-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleIds: selected, promoCode }),
    });
    const data = await response.json();
    if (!response.ok) {
      setPreview(null);
      setError(data.error ?? "Unable to calculate Summer price");
      return;
    }
    setPreview(data);
  }

  return (
    <section className="mb-12 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-center text-xl font-bold">Summer Retakes</h2>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Choose the modules you are retaking this summer.
      </p>
      <div className="mx-auto mt-5 max-w-2xl">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search modules"
          className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          aria-label="Search Summer modules"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleModules.map((module) => (
            <label key={module.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3">
              <input type="checkbox" checked={selected.includes(module.id)} onChange={() => toggle(module.id)} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{module.name}</span>
                <span className="block text-xs text-muted-foreground">
                  Year {module.studyYear} · Term {module.term}
                </span>
              </span>
              <span className="text-sm font-semibold">149 EGP</span>
            </label>
          ))}
        </div>
        {modules.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No modules are currently available for Summer retakes.</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 rounded-lg bg-muted/50 p-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <p className="text-sm">Selected: <strong>{selected.length} modules</strong></p>
            <p className="text-lg font-semibold">Total: {(selected.length * 149).toFixed(2)} EGP</p>
            <p className="text-xs text-muted-foreground">Access until {new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(endsAt)}</p>
          </div>
          <input
            value={promoCode}
            onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
            placeholder="Promo code"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            aria-label="Summer promo code"
          />
          <Button onClick={() => void calculate()} disabled={selected.length === 0}>Continue</Button>
        </div>
        {preview ? (
          <p className="mt-3 text-sm text-emerald-600">
            Server total: {(preview.finalPriceCents / 100).toFixed(2)} EGP
            {preview.discountAmountCents > 0 ? ` (discount ${(preview.discountAmountCents / 100).toFixed(2)} EGP)` : ""}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}
