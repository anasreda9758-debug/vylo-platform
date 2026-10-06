"use client";

import { useState } from "react";
import { Users, Search, Download, ChevronLeft } from "lucide-react";
import { useAdminData, downloadCsv, formatDate } from "./use-admin-data";
import { Badge, ErrorBox, Pagination, Spinner, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { UsersResponse } from "./types";

export type UserDetail = {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  counts: {
    lecturesDone: number;
    quizzesDone: number;
    quizAvgPct: number;
    practicalAnswers: number;
    flashcards: number;
    cases: number;
    caseEvals: number;
    ospeExams: number;
    aiToday: number;
    aiInRange: number;
    aiMonth: number;
  };
  subscriptions: {
    id: string;
    status: string;
    startsAt: string;
    expiresAt: string;
    planName: string | null;
    planScope: string | null;
    planScopeRef: string | null;
  }[];
};

const SORT_LABELS: { key: string; label: string }[] = [
  { key: "last_active", label: "آخر نشاط" },
  { key: "created_at", label: "تاريخ التسجيل" },
  { key: "quizzes", label: "عدد الاختبارات" },
  { key: "lectures", label: "محاضرات مكتملة" },
  { key: "xp", label: "نقاط الخبرة" },
  { key: "name", label: "الاسم" },
];

export function UsersTab({ range }: { range: RangeValue }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState("last_active");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);

  const { data, loading, error } = useAdminData<UsersResponse>(
    "users",
    { range, search, role, studyYear: year, sort, dir, page },
    [search, role, year, sort, dir, page],
  );

  const openDetail = async (id: string) => {
    setSelected(id);
    const params = { range, id };
    const qs = new URLSearchParams({ view: "user" });
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, String(v));
    }
    const res = await fetch(`/api/admin/analytics?${qs.toString()}`);
    if (res.ok) setDetail((await res.json()) as UserDetail);
  };

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  if (selected && detail) {
    return (
      <div className="space-y-4">
        <button
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          onClick={() => {
            setSelected(null);
            setDetail(null);
          }}
        >
          <ChevronLeft className="h-4 w-4" />
          عودة للقائمة
        </button>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{detail.name}</h3>
              <p className="text-sm text-muted-foreground">{detail.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">سجل في {formatDate(detail.createdAt)} · {detail.emailVerified ? "بريد مؤكد" : "بريد غير مؤكد"}</p>
            </div>
            <Badge tone={detail.role === "admin" ? "purple" : "blue"}>{detail.role === "admin" ? "مسؤول" : "طالب"}</Badge>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["محاضرات مكتملة", detail.counts.lecturesDone],
            ["اختبارات مكتملة", detail.counts.quizzesDone],
            ["متوسط دقة الاختبار", `${detail.counts.quizAvgPct}%`],
            ["إجابات عملية", detail.counts.practicalAnswers],
            ["بطاقات منشأة", detail.counts.flashcards],
            ["حالات منشأة", detail.counts.cases],
            ["تقويمات حالات", detail.counts.caseEvals],
            ["امتحانات OSPE", detail.counts.ospeExams],
            ["ذكاء اصطناعي اليوم", detail.counts.aiToday],
            ["ذكاء اصطناعي (نطاق)", detail.counts.aiInRange],
            ["ذكاء اصطناعي (شهر)", detail.counts.aiMonth],
            ["نقاط XP", "—"],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <h4 className="border-b border-border px-4 py-3 text-sm font-semibold">الاشتراكات</h4>
          {detail.subscriptions.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد اشتراكات.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">الخطة</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">النطاق</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">الحالة</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">البداية</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">النهاية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 font-medium">{s.planName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.planScope ?? "—"}{s.planScopeRef ? ` (${s.planScopeRef})` : ""}</td>
                      <td className="px-4 py-3"><Badge tone={s.status === "active" ? "emerald" : s.status === "grace" ? "amber" : s.status === "expired" ? "red" : "muted"}>{s.status}</Badge></td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(s.startsAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(s.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-4 py-2 text-[11px] text-muted-foreground">كامل النشاط متاح من سجل قاعدة البيانات.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border border-border bg-background py-2 ps-9 pe-3 text-sm"
            placeholder="بحث بالاسم أو البريد..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">كل الأدوار</option>
          <option value="student">طالب</option>
          <option value="admin">مسؤول</option>
        </select>
        <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }}>
          <option value="">كل السنوات</option>
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <option key={y} value={y}>سنة {y}</option>
          ))}
        </select>
        <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_LABELS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent" onClick={() => setDir(dir === "desc" ? "asc" : "desc")}>
          {dir === "desc" ? "تنازلي" : "تصاعدي"}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
          onClick={() => void downloadCsv("users", { range, search, role, studyYear: year })}
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {data.users.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {search || role || year ? "لا توجد نتائج مطابقة للفلاتر." : "لا يوجد مستخدمون بعد."}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {data.total.toLocaleString()} مستخدم
              </span>
              <span>{data.filters.studyYear ? `سنة ${data.filters.studyYear}` : ""}</span>
            </div>
            <TableShell
              cols={[
                { key: "user", label: "المستخدم" },
                { key: "role", label: "الدور" },
                { key: "year", label: "السنة" },
                { key: "progress", label: "التقدم", className: "text-center" },
                { key: "ai", label: "ذكاء اليوم", className: "text-center" },
                { key: "sub", label: "الاشتراك", className: "text-center" },
                { key: "last", label: "آخر نشاط" },
              ]}
            >
              {data.users.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-accent/40" onClick={() => void openDetail(u.id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={u.role === "admin" ? "purple" : "blue"}>{u.role === "admin" ? "مشرف" : "طالب"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums">{u.studyYear || "—"}</td>
                  <td className="px-4 py-3 text-center text-xs tabular-nums">
                    {u.lecturesDone} محاضرة · {u.quizzesDone} اختبار
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{u.aiToday >= 15 ? <Badge tone="red">{u.aiToday}</Badge> : <span className="text-sm">{u.aiToday}</span>}</td>
                  <td className="px-4 py-3 text-center">
                    {u.subStatus ? <Badge tone={u.subStatus === "active" ? "emerald" : "amber"}>{u.subStatus}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(u.lastActive)}</td>
                </tr>
              ))}
            </TableShell>
            <Pagination page={data.page} totalPages={Math.ceil(data.total / data.limit)} total={data.total} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}