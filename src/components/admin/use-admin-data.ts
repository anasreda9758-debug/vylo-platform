"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RangeValue = "today" | "7d" | "30d" | "90d" | "this_term" | "custom";

type Params = Record<string, string | number | undefined | null>;

/**
 * Client-side safety net. The server already caps each analytics request, but a
 * dropped connection or a wedged dev server must never leave a tab spinning on
 * "جاري التحميل..." forever — the loading state always settles.
 */
const CLIENT_TIMEOUT_MS = 20000;

function buildQuery(view: string, params: Params, extra?: Params): string {
  const qs = new URLSearchParams();
  qs.set("view", view);
  for (const [k, v] of Object.entries({ ...params, ...extra })) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `/api/admin/analytics?${s}` : "/api/admin/analytics";
}

export function useAdminData<T>(view: string, params: Params = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef({ current: true });
  const paramsKey = JSON.stringify(params);
  const depsKey = deps.map((d) => String(d)).join("|");

  const load = useCallback(
    (unmounted?: { current: boolean }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      fetch(buildQuery(view, params), { signal: controller.signal })
        .then((res) => {
          if (unmounted?.current) return undefined;
          if (!res.ok) {
            setError(res.status === 504 ? "timeout" : `HTTP ${res.status}`);
            setData(null);
            return undefined;
          }
          return res.json() as Promise<T>;
        })
        .then((json) => {
          if (unmounted?.current) return;
          if (json !== undefined) {
            setData(json);
            setError(null);
          }
        })
        .catch((e) => {
          if (unmounted?.current) return;
          setError(e?.name === "AbortError" ? "timeout" : "network_error");
          setData(null);
        })
        .finally(() => {
          clearTimeout(timer);
          if (unmounted?.current) return;
          setLoading(false);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, paramsKey, depsKey],
  );

  useEffect(() => {
    const current = active.current;
    current.current = true;
    void load(current);
    return () => {
      current.current = false;
    };
  }, [load]);

  const reload = useCallback(() => {
    void load(undefined);
  }, [load]);

  return { data, loading, error, reload };
}

/** Triggers a CSV download for the given view. */
export async function downloadCsv(view: string, params: Params = {}): Promise<void> {
  const res = await fetch(buildQuery(view, params, { csv: "1" }));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="(.+?)"/.exec(disposition);
  const filename = match?.[1] ?? `${view}-export.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Parses the timestamp shapes the admin API actually returns.
 *
 * `timestamp without time zone` columns come back as naive strings such as
 * `"2026-08-15 21:02:45.048"`. Passing that straight to `new Date()` is
 * non-standard: V8/Chrome accept it, Safari returns Invalid Date. Normalising
 * the separator to `T` keeps the value in the same (server-local) wall-clock
 * while making it spec-compliant everywhere.
 */
export function parseAdminDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  // Naive `YYYY-MM-DD HH:MM:SS[.sss]` (space separator, no zone) → ISO local form.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)
    ? raw.replace(" ", "T")
    : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = parseAdminDate(value);
  if (!d) return "—";
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`, in the value's own
 * wall-clock. Slicing an ISO/UTC string would feed UTC digits into a control
 * that interprets input as LOCAL time, silently shifting the value by the
 * browser's UTC offset.
 */
export function toDateTimeLocalValue(value: string | Date | null | undefined): string {
  const d = parseAdminDate(value);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatCents(cents: number): string {
  if (!cents) return "0";
  return `${(cents / 100).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
}

export const FEATURE_LABELS: Record<string, string> = {
  flashcard: "بطاقات تعليمية",
  case: "حالات سريرية",
  practical: "أسئلة عملية",
  case_evaluation: "تقويم الحالات",
};

export const REASON_LABELS: Record<string, string> = {
  lecture_complete: "إكمال محاضرة",
  quiz_correct: "إجابة صحيحة",
  quiz_complete_bonus: "مكافأة اختبار",
  flashcard_review: "مراجعة بطاقة",
  case_complete: "إكمال حالة",
  daily_streak: "سلسلة يومية",
  battle_win: "فوز في تحدي",
  battle_lose: "مشاركة في تحدي",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  register: "تسجيل جديد",
  lecture: "أكمل محاضرة",
  quiz: "أنهى اختباراً",
  practical: "أجاب سؤالاً عملياً",
  case_eval: "قيّم حالة سريرية",
  subscription: "اشتراك جديد",
  ospe_exam: "أنهى OSPE",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  reorder: "ترتيب",
  payment: "دفع",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  module: "موديول",
  lecture: "محاضرة",
  subject: "مادة",
  university: "جامعة",
  faculty: "كلية",
  program: "برنامج",
  academic_year: "سنة دراسية",
  semester: "ترم",
  subscription: "اشتراك",
};