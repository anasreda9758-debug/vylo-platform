"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { normalizeAcademicTimestamp } from "@/features/hierarchy/academic-visibility";

type Period = {
  id: string;
  academicYear: string;
  type: "TERM_1" | "TERM_2" | "SUMMER";
  startsAt: string;
  endsAt: string;
  active: boolean;
};

export function AcademicPeriodAdmin() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function load() {
    const response = await fetch("/api/admin/academic-periods");
    if (response.ok) {
      const data = await response.json();
      setPeriods(data.periods);
      setWarnings(data.warnings ?? []);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(period: Period, startsAt: string, endsAt: string) {
    setError(null);
    const response = await fetch("/api/admin/academic-periods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: period.id, startsAt, endsAt, active: period.active }),
    });
    if (!response.ok) setError((await response.json()).error ?? "Unable to save period");
    else await load();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 font-semibold">Academic periods</h3>
      <p className="mb-3 text-sm text-muted-foreground">Dates use Africa/Cairo. Future terms are hidden; Summer is visible only while active, outside ordinary terms.</p>
      {warnings.length > 0 && <ul role="alert" className="mb-4 list-inside list-disc rounded-lg border border-amber-500/40 p-3 text-sm text-amber-800 dark:text-amber-200">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="space-y-3">
        {periods.map((period) => (
          <PeriodRow key={period.id} period={period} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function PeriodRow({ period, onSave }: { period: Period; onSave: (period: Period, startsAt: string, endsAt: string) => Promise<void> }) {
  const [startsAt, setStartsAt] = useState(normalizeAcademicTimestamp(period.startsAt) ?? "");
  const [endsAt, setEndsAt] = useState(normalizeAcademicTimestamp(period.endsAt) ?? "");
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <div><p className="text-xs text-muted-foreground">{period.academicYear}</p><p className="font-medium">{period.type}</p></div>
      <label className="text-xs text-muted-foreground">Starts<input type="datetime-local" step="0.001" className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
      <label className="text-xs text-muted-foreground">Ends<input type="datetime-local" step="0.001" className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-sm" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
      <Button size="sm" onClick={() => void onSave(period, startsAt, endsAt)}>Save</Button>
    </div>
  );
}
