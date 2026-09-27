"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { WeeklyPlan, PlanDay } from "@/features/planning/weeklyPlan";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; plan: WeeklyPlan };

const KIND_LABEL: Record<string, string> = {
  LECTURE: "Lecture",
  FLASHCARDS: "Flashcards",
  QUIZ: "Quiz",
  PRACTICAL: "Practical",
  OSPE: "OSPE",
  REST: "Rest",
};

/**
 * Deterministic weekly plan card.
 *
 * Every terminal state is explicit: loading, error (with retry) and a truthful
 * empty state. The plan is fetched once and never polled, so a slow response
 * can never produce a permanent spinner.
 */
export default function WeeklyPlanCard() {
  const [attempt, setAttempt] = useState(0);
  // Keying on attempt remounts the fetcher, so a retry starts in the loading
  // state without synchronously setting state inside an effect.
  return <PlanBody key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

function PlanBody({ onRetry }: { onRetry: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    fetch("/api/planning/weekly", { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) throw new Error("Please sign in again to see your plan.");
        if (!res.ok) throw new Error("Your weekly plan is unavailable right now.");
        return (await res.json()) as { plan: WeeklyPlan };
      })
      .then((data) => setState({ status: "ready", plan: data.plan }))
      .catch((e: Error) => {
        if (controller.signal.aborted) {
          setState({ status: "error", message: "Your weekly plan took too long to load." });
          return;
        }
        setState({ status: "error", message: e.message });
      })
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (state.status === "loading") {
    return (
      <section className="rounded-xl border bg-card p-6" aria-busy="true">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
          This week
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Building your study plan…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="rounded-xl border bg-card p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
          This week
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </section>
    );
  }

  const { plan } = state;

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
          This week
        </h2>
        <span className="text-xs text-muted-foreground">{plan.totalMinutes} min planned</span>
      </div>

      {plan.isEmpty ? (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Nothing due right now
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {plan.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {plan.days.slice(0, 7).map((day: PlanDay) => (
              <li key={day.date} className="rounded-lg border p-3">
                <p className="mb-1 text-sm font-semibold">
                  {day.weekday}
                  {day.isToday ? <span className="ml-2 text-xs font-normal text-primary">today</span> : null}
                  {day.totalMinutes > 0 ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{day.totalMinutes} min</span>
                  ) : null}
                </p>
                {day.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No planned work.</p>
                ) : (
                  <ul className="space-y-1">
                    {day.items.map((item, i) => (
                      <li key={`${day.date}-${i}`} className="text-sm">
                        <span className="mr-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium">
                          {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                        {item.href ? (
                          <Link href={item.href} className="text-primary hover:underline">
                            {item.title}
                          </Link>
                        ) : (
                          <span>{item.title}</span>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {plan.notes.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
