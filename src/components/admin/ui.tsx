"use client";

import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const TONES: Record<string, string> = {
  muted: "bg-muted text-muted-foreground",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

export function Badge({ tone = "muted", children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone] ?? TONES.muted)}>
      {children}
    </span>
  );
}

export function Panel({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-2xl border border-border bg-card", className)}>
      {(title || hint || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

export function Spinner({ text = "جاري التحميل..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-12 text-sm text-muted-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
      {text}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-6 text-center text-sm text-red-600 dark:text-red-400">
      تعذر تحميل البيانات — {message}
    </div>
  );
}

export function KpiCard({
  icon,
  label,
  value,
  sub,
  color = "text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400",
  onClick,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
  onClick?: () => void;
  hint?: string;
}) {
  const Tag = onClick ? "button" : "div";
  const Icon = icon;
  return (
    <Tag
      onClick={onClick}
      className={cx(
        "rounded-2xl border border-border bg-card p-4 text-start",
        onClick && "cursor-pointer transition-colors hover:bg-accent",
      )}
      title={hint}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className={cx("inline-flex h-8 w-8 items-center justify-center rounded-lg", color)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Tag>
  );
}

export function StatPill({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {tone && <span className="mt-1 block">{tone}</span>}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
      <span className="text-xs text-muted-foreground">الإجمالي: {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <button
          className="rounded-lg border border-border px-3 py-1 text-xs disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          السابق
        </button>
        <span className="mx-1 text-xs text-muted-foreground tabular-nums">
          صفحة {page} من {totalPages}
        </span>
        <button
          className="rounded-lg border border-border px-3 py-1 text-xs disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          التالي
        </button>
      </div>
    </div>
  );
}

/** Minimal dependency-free bar chart. value is normalized across items. */
export function BarChart({
  data,
  color = "bg-primary/70",
  format,
  empty,
}: {
  data: { label: string; value: number }[];
  color?: string;
  format?: (v: number) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <EmptyState text={empty ?? "لا توجد بيانات في هذه الفترة."} />;
  return (
    <div className="space-y-2 px-4 py-4">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={d.label}>
            {d.label}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
            <div className={cx("flex h-full items-center rounded-md pl-2", color)} style={{ width: `${(d.value / max) * 100}%` }}>
              {d.value > 0 && <span className="w-full truncate pr-2 text-right text-[10px] font-medium text-white/90">{format ? format(d.value) : d.value}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tiny per-day bar strip, used for activity series. */
export function DayBars({ days, color = "bg-primary/70", empty }: { days: { day: string; value: number }[]; color?: string; empty?: string }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  if (days.length === 0) return <EmptyState text={empty ?? "لا يوجد نشاط مسجل في الفترة المحددة."} />;
  return (
    <div className="overflow-x-auto px-4 py-4">
      <div className="flex h-32 items-end gap-[2px]" dir="ltr">
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${d.value}`}>
            <div className={cx("w-full rounded-t-sm", color)} style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </div>
  );
}

export function TableShell({ children, cols }: { children: ReactNode; cols: { key: string; label: string; className?: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {cols.map((c) => (
              <th key={c.key} className={cx("px-4 py-3 text-start font-medium text-muted-foreground", c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}