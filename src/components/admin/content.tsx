"use client";

import { useState } from "react";
import { Download, Search, CheckCircle2, AlertCircle } from "lucide-react";
import { useAdminData, downloadCsv } from "./use-admin-data";
import { Badge, ErrorBox, Panel, Pagination, Spinner, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { ContentResponse } from "./types";

export function ContentTab({ range }: { range: RangeValue }) {
  const [termFilter, setTermFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, loading, error } = useAdminData<ContentResponse>(
    "content",
    { range, term: termFilter, studyYear: yearFilter, search, page, limit: 25 },
    [termFilter, yearFilter, search, page],
  );

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Panel title="جاهزية المنهج حسب الفترات (T1..T10)" hint="كل الأرقام من قاعدة البيانات — جاهز = محتوى مكتمل + أسئلة أو مسار عملي">
        {data.curriculum.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">لا توجد وحدات منهج مسجلة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-start font-medium text-muted-foreground">الترم</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">موديولات</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">محاضرات</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">بمحتوى</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">ناقصة</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">PDF</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">ملخص ذكي</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Mindmap</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">بنوك/أسئلة</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">عملي</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.curriculum.map((c) => (
                  <tr key={`${c.studyYear}-${c.term}`}>
                    <td className="px-4 py-3 font-medium">
                      T{c.studyYear}.{c.term}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.modules}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.lectures}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-emerald-600">{c.lecturesWithContent}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.lecturesMissingContent > 0 ? <span className="text-amber-600">{c.lecturesMissingContent}</span> : "0"}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.lecturesWithPdf}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.lecturesWithAi}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.lecturesWithMindmap}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.banks}/{c.questions}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{c.tracks}/{c.practicalQuestions}</td>
                    <td className="px-4 py-3 text-center">
                      {c.ready ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> جاهز
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                          <AlertCircle className="h-3.5 w-3.5" /> ناقص
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="صحة الموديولات"
        hint="لكل موديول: عدد المحاضرات والبنوك والمسارات."
        actions={
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
              <option value="">كل الأترام</option>
              <option value="1">الترم 1</option>
              <option value="2">الترم 2</option>
            </select>
            <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="">كل السنوات</option>
              {[1, 2, 3, 4, 5, 6].map((y) => (
                <option key={y} value={y}>سنة {y}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input className="w-40 rounded-lg border border-border bg-background py-1 ps-7 pe-2 text-xs" placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        }
      >
        {data.modules.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد موديولات.</p>
        ) : (
          <TableShell
            cols={[
              { key: "module", label: "الموديول" },
              { key: "term", label: "T", className: "text-center" },
              { key: "lectures", label: "محاضرات", className: "text-center" },
              { key: "missing", label: "ناقصة", className: "text-center" },
              { key: "pdf", label: "PDF", className: "text-center" },
              { key: "qa", label: "بنوك/أسئلة", className: "text-center" },
              { key: "practical", label: "عملي", className: "text-center" },
              { key: "activity", label: "تقدم", className: "text-center" },
            ]}
          >
            {data.modules.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2.5 font-medium">{m.name}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.studyYear}.{m.term}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.lectures}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.lecturesMissingContent > 0 ? <Badge tone="amber">{m.lecturesMissingContent}</Badge> : <span className="text-emerald-600">0</span>}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.lecturesWithPdf}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.banks}/{m.questions}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.tracks}/{m.practicalQuestions}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{m.progressEvents}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>

      <Panel
        title="صحة المحاضرات"
        hint="مراجعة جاهزية المحاضرات مع ترقيم صفحات."
        actions={
          <button className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => void downloadCsv("content", { search, term: termFilter, studyYear: yearFilter })}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        }
      >
        {data.lectures.lectures.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا توجد محاضرات مطابقة.</p>
        ) : (
          <>
            <TableShell
              cols={[
                { key: "title", label: "المحاضرة" },
                { key: "module", label: "الموديول" },
                { key: "content", label: "محتوى", className: "text-center" },
                { key: "pdf", label: "PDF", className: "text-center" },
                { key: "summary", label: "ملخص", className: "text-center" },
                { key: "mindmap", label: "Mindmap", className: "text-center" },
                { key: "progress", label: "إكمالات", className: "text-center" },
              ]}
            >
              {data.lectures.lectures.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 font-medium">{l.title}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.moduleName}</td>
                  <td className="px-4 py-2.5 text-center">{l.hasContent ? <Badge tone="emerald">نعم</Badge> : <Badge tone="amber">لا</Badge>}</td>
                  <td className="px-4 py-2.5 text-center">{l.hasPdf ? <Badge tone="emerald">نعم</Badge> : <Badge tone="muted">لا</Badge>}</td>
                  <td className="px-4 py-2.5 text-center">{l.hasSummary ? <Badge tone="emerald">نعم</Badge> : <Badge tone="muted">لا</Badge>}</td>
                  <td className="px-4 py-2.5 text-center">{l.hasMindmap ? <Badge tone="emerald">نعم</Badge> : <Badge tone="muted">لا</Badge>}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">{l.progressEvents}</td>
                </tr>
              ))}
            </TableShell>
            <Pagination page={data.lectures.page} totalPages={Math.ceil(data.lectures.total / data.lectures.limit)} total={data.lectures.total} onChange={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}