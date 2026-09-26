"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PromoCodeAdmin } from "@/components/promo-code-admin";
import { AcademicPeriodAdmin } from "@/components/academic-period-admin";
import { RedeemCodeAdmin } from "@/components/redeem-code-admin";
import { OverviewTab } from "@/components/admin/overview";
import { UsersTab } from "@/components/admin/users";
import { SubscriptionsTab } from "@/components/admin/subscriptions";
import { ContentTab } from "@/components/admin/content";
import { LearningTab } from "@/components/admin/learning";
import { QuizTab } from "@/components/admin/quiz";
import { PracticalTab } from "@/components/admin/practical";
import { OspeTab } from "@/components/admin/ospe";
import { ReviewTab } from "@/components/admin/review";
import { AiTab } from "@/components/admin/ai";
import { XpTab } from "@/components/admin/xp";
import { ActivityTab } from "@/components/admin/activity";
import { PaymentsTab } from "@/components/admin/payments";
import { AuditTab } from "@/components/admin/audit";
import { SystemTab } from "@/components/admin/system";
import { useAdminData, type RangeValue } from "@/components/admin/use-admin-data";
import type { SystemHealth } from "@/components/admin/types";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
  BookOpen,
  Users,
  LayoutDashboard,
  BarChart3,
  CreditCard,
  Calendar,
  Gift,
  GraduationCap,
  Activity,
  Stethoscope,
  Bot,
  Star,
  ListChecks,
  Wallet,
  KeyRound,
  History,
  Server,
  Database,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

type Module = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  order: number;
  isFree: boolean;
  studyYear: number;
  term: number;
  lectureCount: number;
};

type Lecture = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  subject: string | null;
  kind: string | null;
  content: string | null;
  hasPdf: boolean;
  order: number;
  durationMin: number | null;
  pdfPageStart?: number | null;
  pdfPageEnd?: number | null;
};

type AdminTab =
  | "overview"
  | "users"
  | "subscriptions"
  | "content"
  | "curriculum"
  | "learning"
  | "quiz"
  | "practical"
  | "ospe"
  | "review"
  | "ai"
  | "xp"
  | "activity"
  | "payments"
  | "promos"
  | "redeem"
  | "periods"
  | "audit"
  | "system";

// ── Module Form ──

function ModuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Module;
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [term, setTerm] = useState(initial?.term ?? 1);
  const [studyYear, setStudyYear] = useState(initial?.studyYear ?? 1);
  const [isFree, setIsFree] = useState(initial?.isFree ?? false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({ name, slug: slug || undefined, description, studyYear, term, isFree, id: initial?.id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">الاسم</label>
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Slug</label>
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generate" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">الوصف</label>
        <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex items-center gap-4">
        <div>
          <label className="text-xs text-muted-foreground">السنة الدراسية</label>
          <input type="number" min={1} max={12} className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={studyYear} onChange={(e) => setStudyYear(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">الترم</label>
          <select className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={term} onChange={(e) => setTerm(Number(e.target.value))}>
            <option value={1}>الترم الأول</option>
            <option value={2}>الترم الثاني</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
          مجاني
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy || !name.trim()}>
          <Save className="ml-1 h-3.5 w-3.5" />
          {initial ? "تحديث" : "إنشاء"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="ml-1 h-3.5 w-3.5" />
          إلغاء
        </Button>
      </div>
    </div>
  );
}

// ── Lecture Form ──

function LectureForm({
  moduleId,
  initial,
  onSave,
  onCancel,
}: {
  moduleId: string;
  initial?: Lecture;
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "lecture");
  const [durationMin, setDurationMin] = useState(initial?.durationMin?.toString() ?? "");
  const [pageStart, setPageStart] = useState(initial?.pdfPageStart?.toString() ?? "");
  const [pageEnd, setPageEnd] = useState(initial?.pdfPageEnd?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave({
        moduleId,
        title,
        slug: slug || undefined,
        summary,
        kind,
        durationMin: durationMin ? Number(durationMin) : null,
        pdfPageStart: pageStart ? Number(pageStart) : null,
        pdfPageEnd: pageEnd ? Number(pageEnd) : null,
        id: initial?.id,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3 ml-8">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">العنوان</label>
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Slug</label>
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generate" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">ملخص</label>
        <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="flex items-center gap-4">
        <div>
          <label className="text-xs text-muted-foreground">النوع</label>
          <select className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="lecture">محاضرة</option>
            <option value="seminar">سيمينار</option>
            <option value="practical">عملي</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">المدة (دقيقة)</label>
          <input type="number" className="mt-1 w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
        </div>
        {initial?.hasPdf && (
          <>
            <div>
              <label className="text-xs text-muted-foreground">صفحة البداية</label>
              <input type="number" min={1} className="mt-1 w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={pageStart} onChange={(e) => setPageStart(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">صفحة النهاية</label>
              <input type="number" min={1} className="mt-1 w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={pageEnd} onChange={(e) => setPageEnd(e.target.value)} placeholder="—" />
            </div>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy || !title.trim()}>
          <Save className="ml-1 h-3.5 w-3.5" />
          {initial ? "تحديث" : "إنشاء"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="ml-1 h-3.5 w-3.5" />
          إلغاء
        </Button>
      </div>
    </div>
  );
}

// ── Header meta (env / db / git / Cairo time) ──

function ControlHeaderBadges() {
  const { data } = useAdminData<SystemHealth>("system");
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
        <Server className="h-3 w-3" />
        {data ? data.env.nodeEnv : "…"}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
        <Database className="h-3 w-3" />
        {data ? (data.db.connected ? "قاعدة بيانات متصلة" : "قاعدة بيانات غير متصلة") : "…"}
      </span>
      {data?.git.short && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono" dir="ltr">
          {data.git.short}
        </span>
      )}
      {data?.time.cairoDate && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
          <Calendar className="h-3 w-3" />
          {data.time.cairoDate} (Cairo)
        </span>
      )}
    </div>
  );
}

// ── Main Admin Panel ──

export function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [range, setRange] = useState<RangeValue>("30d");

  // Curriculum state
  const [modules, setModules] = useState<Module[]>([]);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [lectures, setLectures] = useState<Record<string, Lecture[]>>({});
  const [editingModule, setEditingModule] = useState<string | null>(null);
  const [creatingModule, setCreatingModule] = useState(false);
  const [editingLecture, setEditingLecture] = useState<string | null>(null);
  const [creatingLectureFor, setCreatingLectureFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const fetchModules = useCallback(() => {
    fetch("/api/admin/modules")
      .then((r) => r.json())
      .then((d) => setModules(d.modules))
      .catch(() => {});
  }, []);

  const fetchLectures = useCallback(async (moduleId: string) => {
    const res = await fetch(`/api/admin/lectures?moduleId=${moduleId}`);
    if (res.ok) {
      const data = await res.json();
      setLectures((prev) => ({ ...prev, [moduleId]: data.lectures }));
    }
  }, []);

  useEffect(fetchModules, [fetchModules]);

  // ── Module CRUD ──

  async function saveModule(data: any) {
    const method = data.id ? "PUT" : "POST";
    const res = await fetch("/api/admin/modules", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setCreatingModule(false);
      setEditingModule(null);
      fetchModules();
    }
  }

  async function deleteModule(id: string) {
    if (!confirm("هل أنت متأكد من حذف هذا الموديول وكل محاضراته؟")) return;
    const res = await fetch(`/api/admin/modules?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setModules((prev) => prev.filter((m) => m.id !== id));
    }
  }

  // ── Lecture CRUD ──

  async function saveLecture(data: any) {
    const method = data.id ? "PUT" : "POST";
    const res = await fetch("/api/admin/lectures", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setCreatingLectureFor(null);
      setEditingLecture(null);
      if (data.moduleId) fetchLectures(data.moduleId);
    }
  }

  async function deleteLecture(id: string, moduleId: string) {
    if (!confirm("هل أنت متأكد من حذف هذه المحاضرة؟")) return;
    const res = await fetch(`/api/admin/lectures?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchLectures(moduleId);
    }
  }

  // ── Drag & Drop ──

  async function handleDrop(entityType: "module" | "lecture", items: { id: string; order: number }[]) {
    await fetch("/api/admin/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, items }),
    });
    fetchModules();
  }

  const TABS: { key: AdminTab; label: string; icon: LucideIcon }[] = [
    { key: "overview", label: "نظرة عامة", icon: LayoutDashboard },
    { key: "users", label: "المستخدمون", icon: Users },
    { key: "subscriptions", label: "الاشتراكات", icon: CreditCard },
    { key: "content", label: "صحة المحتوى", icon: Database },
    { key: "curriculum", label: "إدارة المنهج", icon: BookOpen },
    { key: "quiz", label: "الاختبارات", icon: BarChart3 },
    { key: "practical", label: "العملي", icon: GraduationCap },
    { key: "ospe", label: "OSPE", icon: Stethoscope },
    { key: "review", label: "المراجعة", icon: FileText },
    { key: "learning", label: "التعلم", icon: Activity },
    { key: "ai", label: "الذكاء الاصطناعي", icon: Bot },
    { key: "xp", label: "نقاط XP", icon: Star },
    { key: "activity", label: "الأحداث", icon: ListChecks },
    { key: "payments", label: "المدفوعات", icon: Wallet },
    { key: "promos", label: "أكواد الخصم", icon: Gift },
    { key: "redeem", label: "أكواد الاسترداد", icon: KeyRound },
    { key: "periods", label: "الفترات", icon: Calendar },
    { key: "audit", label: "سجل التدقيق", icon: History },
    { key: "system", label: "حالة النظام", icon: ScrollText },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Global header: range + env/db/git badges */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ControlHeaderBadges />
        {tab !== "overview" && tab !== "curriculum" && tab !== "promos" && tab !== "redeem" && tab !== "periods" && tab !== "system" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            النطاق الزمني
            <select className="rounded-lg border border-border bg-background px-2 py-1 text-xs" value={range} onChange={(e) => setRange(e.target.value as RangeValue)}>
              <option value="today">اليوم</option>
              <option value="7d">آخر 7 أيام</option>
              <option value="30d">آخر 30 يوم</option>
              <option value="90d">آخر 90 يوم</option>
              <option value="this_term">هذا الترم</option>
            </select>
          </label>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-card p-1">
        <div className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Analytics tabs ── */}
      {tab === "overview" && <OverviewTab onNavigate={(t) => setTab(t as AdminTab)} />}
      {tab === "users" && <UsersTab range={range} />}
      {tab === "subscriptions" && <SubscriptionsTab range={range} />}
      {tab === "content" && <ContentTab range={range} />}
      {tab === "learning" && <LearningTab range={range} />}
      {tab === "quiz" && <QuizTab range={range} />}
      {tab === "practical" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">تحليلات أسئلة المسارات العملية.</p>
            <Link href="/admin/practical" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-primary hover:bg-accent">
              <GraduationCap className="h-4 w-4" />
              صفحة تأليف العملي
            </Link>
          </div>
          <PracticalTab range={range} onNavigate={(t) => setTab(t as AdminTab)} />
        </div>
      )}
      {tab === "ospe" && <OspeTab range={range} />}
      {tab === "review" && <ReviewTab range={range} />}
      {tab === "ai" && <AiTab range={range} />}
      {tab === "xp" && <XpTab range={range} />}
      {tab === "activity" && <ActivityTab range={range} />}
      {tab === "payments" && <PaymentsTab range={range} />}
      {tab === "audit" && <AuditTab range={range} />}
      {tab === "system" && <SystemTab />}

      {/* ── Management tabs ── */}
      {tab === "promos" && <PromoCodeAdmin />}
      {tab === "redeem" && <RedeemCodeAdmin />}
      {tab === "periods" && <AcademicPeriodAdmin />}

      {/* ── Curriculum Tab (management) ── */}
      {tab === "curriculum" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">إدارة المنهج</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={fetchModules}>تحديث</Button>
              <Button size="sm" onClick={() => setCreatingModule(true)}>
                <Plus className="ml-1 h-3.5 w-3.5" />
                موديول جديد
              </Button>
            </div>
          </div>

          {creatingModule && (
            <div className="mb-4">
              <ModuleForm onSave={saveModule} onCancel={() => setCreatingModule(false)} />
            </div>
          )}

          <div className="space-y-2">
            {modules.map((m) => (
              <div key={m.id} className="rounded-xl border border-border bg-card">
                {/* Module row */}
                <div
                  draggable
                  onDragStart={() => setDragId(m.id)}
                  onDragEnd={() => {
                    if (dragId && dragId !== m.id) {
                      const ids = modules.map((x) => x.id);
                      const fromIdx = ids.indexOf(dragId);
                      const toIdx = ids.indexOf(m.id);
                      const newIds = [...ids];
                      newIds.splice(fromIdx, 1);
                      newIds.splice(toIdx, 0, dragId);
                      handleDrop("module", newIds.map((id, i) => ({ id, order: i + 1 })));
                    }
                    setDragId(null);
                  }}
                  className={`flex items-center gap-3 p-4 cursor-grab ${dragId === m.id ? "opacity-50" : ""}`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.term === 1 ? "الترم ١" : "الترم ٢"}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.lectureCount} محاضرة</span>
                      {m.isFree && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">مجاني</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">/{m.slug}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedModule(expandedModule === m.id ? null : m.id)}>
                      {expandedModule === m.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingModule(editingModule === m.id ? null : m.id)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => deleteModule(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Edit module form */}
                {editingModule === m.id && (
                  <div className="px-4 pb-4">
                    <ModuleForm initial={m} onSave={saveModule} onCancel={() => setEditingModule(null)} />
                  </div>
                )}

                {/* Expanded lectures */}
                {expandedModule === m.id && (
                  <div className="border-t border-border px-4 pb-4 pt-2">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">المحاضرات ({m.lectureCount})</span>
                      <Button size="sm" variant="outline" onClick={() => { setCreatingLectureFor(creatingLectureFor === m.id ? null : m.id); if (!lectures[m.id]) fetchLectures(m.id); }}>
                        <Plus className="ml-1 h-3 w-3" />
                        محاضرة
                      </Button>
                    </div>

                    {creatingLectureFor === m.id && (
                      <div className="mb-2">
                        <LectureForm moduleId={m.id} onSave={saveLecture} onCancel={() => setCreatingLectureFor(null)} />
                      </div>
                    )}

                    {!lectures[m.id] ? (
                      <p className="text-xs text-muted-foreground">جاري التحميل...</p>
                    ) : lectures[m.id].length === 0 ? (
                      <p className="text-xs text-muted-foreground">لا توجد محاضرات</p>
                    ) : (
                      <div className="space-y-1">
                        {lectures[m.id].map((l) => (
                          <div key={l.id} className="flex items-center gap-3 rounded-lg bg-background p-3">
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                            <div className="flex-1">
                              <span className="text-sm font-medium">{l.title}</span>
                              {l.kind && <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">{l.kind === "lecture" ? "محاضرة" : l.kind === "seminar" ? "سيمينار" : "عملي"}</span>}
                              {l.hasPdf && <FileText className="mr-1 inline h-3 w-3 text-muted-foreground" />}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingLecture(editingLecture === l.id ? null : l.id)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteLecture(l.id, m.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}