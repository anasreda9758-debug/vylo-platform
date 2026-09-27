"use client";

import { Users, GraduationCap, CreditCard, BookOpen, BarChart3, Bot, Star, AlertTriangle, Activity, FileText, ScrollText, CircleDollarSign } from "lucide-react";
import { useAdminData, formatDate, formatCents, FEATURE_LABELS } from "./use-admin-data";
import { BarChart, EmptyState, KpiCard, Panel, Spinner, ErrorBox } from "./ui";
import type { Overview } from "./types";

const WARNING_TONES: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-600 dark:text-red-400",
  WARNING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  INFO: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, loading, error, reload } = useAdminData<Overview>("overview");

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* KPI: Users */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">المستخدمون</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={Users} label="إجمالي المستخدمين" value={data.users.total} sub={`${data.users.students} طالب · ${data.users.admins} إدارة`} color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" onClick={() => onNavigate("users")} />
          <KpiCard icon={Users} label="جدد اليوم" value={data.users.newToday} sub="سجلوا خلال اليوم" color="text-sky-600 bg-sky-50 dark:bg-sky-950/40" onClick={() => onNavigate("users")} />
          <KpiCard icon={Activity} label="نشطون اليوم" value={data.users.activeToday} sub={`7 أيام: ${data.users.active7d} · 30 يوم: ${data.users.active30d}`} color="text-teal-600 bg-teal-50 dark:bg-teal-950/40" onClick={() => onNavigate("users")} />
          <KpiCard icon={BarChart3} label="اختبارات مكتملة" value={data.quiz.completed} sub={`متوسط النجاح ${data.quiz.avgScorePct}%`} color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" onClick={() => onNavigate("quiz")} />
        </div>
      </div>

      {/* KPI: Subscriptions */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">الاشتراكات والمدفوعات</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={CreditCard} label="اشتراكات نشطة" value={data.subscriptions.active} sub={`${data.subscriptions.subscribers} مشترك فريد`} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" onClick={() => onNavigate("subscriptions")} />
          <KpiCard icon={CircleDollarSign} label="ضمن مهلة السماح" value={data.subscriptions.grace} sub={`${data.subscriptions.expired} منتهية`} color="text-orange-600 bg-orange-50 dark:bg-orange-950/40" onClick={() => onNavigate("subscriptions")} />
          <KpiCard icon={AlertTriangle} label="تنتهي خلال 7 أيام" value={data.subscriptions.expiring7d} sub="تحتاج متابعة" color="text-red-600 bg-red-50 dark:bg-red-950/40" onClick={() => onNavigate("subscriptions")} />
          <KpiCard icon={CircleDollarSign} label="قيمة الاشتراكات النشطة" value={formatCents(data.subscriptions.activeValueCents)} sub={data.payments.enabled ? "بوابة الدفع مفعّلة" : "الدفع الإلكتروني معطّل"} color="text-green-600 bg-green-50 dark:bg-green-950/40" onClick={() => onNavigate("payments")} hint="قيمة تقديرية من أسعار الخطط المسجلة — ليست إيرادات مدفوعة" />
        </div>
      </div>

      {/* KPI: Content */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">المحتوى</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={BookOpen} label="المحاضرات" value={data.content.lectures} sub={`${data.content.lecturesWithContent} بمحتوى مكتمل`} color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" onClick={() => onNavigate("content")} />
          <KpiCard icon={BookOpen} label="الموديولات" value={data.content.modules} sub={`${data.content.modulesNoLectures} بدون محاضرات`} color="text-violet-600 bg-violet-50 dark:bg-violet-950/40" onClick={() => onNavigate("content")} />
          <KpiCard icon={FileText} label="أسئلة الاختبارات" value={data.content.questions} sub={`${data.content.banks} بنك أسئلة`} color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" onClick={() => onNavigate("quiz")} />
          <KpiCard icon={GraduationCap} label="أسئلة عملية" value={data.content.practicalQuestions} sub={`${data.content.tracks} مسار · ${data.content.ospeStations} محطة OSPE مهيأة`} color="text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40" onClick={() => onNavigate("practical")} />
        </div>
      </div>

      {/* KPI: Learning + AI + XP */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">التعلم والذكاء الاصطناعي</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={GraduationCap} label="محاضرات مكتملة" value={data.learning.lectures} sub="ضمن النطاق المحدد" color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" onClick={() => onNavigate("learning")} />
          <KpiCard icon={Bot} label="عمليات الذكاء اليوم" value={data.ai.usedToday} sub={`حد يومي ${data.meta.aiDailyLimit} لكل طالب`} color="text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-950/40" onClick={() => onNavigate("ai")} />
          <KpiCard icon={Star} label="نقاط الخبرة (XP)" value={data.xp.totalXp} sub={`${data.xp.todayXp} اليوم · ${data.xp.activeStreaks} سلسلة نشطة`} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" onClick={() => onNavigate("xp")} />
          <KpiCard icon={Activity} label="أحداث نشاط" value={data.learning.xpEvents + data.learning.quizAnswers} sub="إجابات + أحداث XP" color="text-slate-600 bg-slate-100 dark:bg-slate-800/60" onClick={() => onNavigate("activity")} />
        </div>
      </div>

      {/* Attention center */}
      <Panel title="Needs Attention — ما يحتاج اهتماماً" hint="تحذيرات مبنية على بيانات حقيقية فقط">
        <ul className="divide-y divide-border">
          {data.warnings.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${WARNING_TONES[w.severity]}`}>{w.severity}</span>
                <div>
                  <p className="text-sm font-medium">{w.title}</p>
                  <p className="text-xs text-muted-foreground">{w.detail}</p>
                </div>
              </div>
              {w.view ? (
                <button className="shrink-0 text-xs text-primary hover:underline" onClick={() => onNavigate(w.view!)}>
                  فتح
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top modules */}
        <Panel title="أكثر الموديولات استخداماً" hint="إكمال محاضرات في النطاق الحالي">
          {data.topModules.length === 0 ? (
            <EmptyState text="لا يوجد نشاط مسجل في هذه الفترة." />
          ) : (
            <BarChart data={data.topModules.map((m) => ({ label: m.name, value: m.completions }))} empty="لا يوجد نشاط." />
          )}
        </Panel>

        {/* AI features */}
        <Panel title="توزيع عمليات الذكاء الاصطناعي" hint="حسب الميزة في النطاق الحالي">
          {data.ai.featureBreakdown.length === 0 ? (
            <EmptyState text="لا توجد عمليات ذكاء اصطناعي مسجلة في هذه الفترة." />
          ) : (
            <BarChart data={data.ai.featureBreakdown.map((f) => ({ label: FEATURE_LABELS[f.feature] ?? f.feature, value: f.total }))} empty="لا توجد بيانات." />
          )}
        </Panel>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ScrollText className="h-3.5 w-3.5" />
          آخر تحديث: {formatDate(data.meta.generatedAt)}
        </span>
        <button className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent" onClick={() => void reload()}>
          تحديث البيانات
        </button>
      </div>
    </div>
  );
}