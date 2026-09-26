"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RangeValue = "today" | "7d" | "30d" | "90d" | "this_term" | "custom";

type Params = Record<string, string | number | undefined | null>;

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
      fetch(buildQuery(view, params))
        .then((res) => {
          if (unmounted?.current) return undefined;
          if (!res.ok) {
            setError(`HTTP ${res.status}`);
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
        .catch(() => {
          if (unmounted?.current) return;
          setError("network_error");
          setData(null);
        })
        .finally(() => {
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

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
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