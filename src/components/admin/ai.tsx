"use client";

import { Sparkles, Server, Coins, Gauge, CircleDollarSign } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { BarChart, DayBars, EmptyState, KpiCard, Panel, Spinner, ErrorBox } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { AiResponse } from "./types";

export function AiTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<AiResponse>("ai", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  const tokensToday = data.tokens.input + data.tokens.output;
  const freeTotal = data.buckets.pct0 + data.buckets.pct25 + data.buckets.pct50 + data.buckets.pct75 + data.buckets.pct100 + data.buckets.unused;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Sparkles} label="توليدات اليوم" value={data.usedToday} sub={`حد يومي ${data.dailyLimit} لكل طالب`} color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
        <KpiCard icon={Server} label="استدعاءات المزود" value={data.hosted.calls} sub="سجلات ai_usage في النطاق" color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <KpiCard icon={Gauge} label="توكنات في النطاق" value={tokensToday.toLocaleString("ar-EG")} sub={`إدخال ${data.tokens.input.toLocaleString("ar-EG")} · إخراج ${data.tokens.output.toLocaleString("ar-EG")}`} color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={Coins} label="طلاب بالحصة الكاملة" value={data.buckets.pct100} sub={`ضمن ${freeTotal} ملف حصة`} color="text-amber-600 bg-amber-50 dark:bg-amber-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="التوليدات حسب الميزة" hint="flashcard / case / practical">
          {data.features.length === 0 ? (
            <EmptyState text="لا توجد توليدات ذكية في هذه الفترة." />
          ) : (
            <BarChart data={data.features.map((f) => ({ label: f.feature, value: f.total }))} empty="لا توجد بيانات." />
          )}
        </Panel>

        <Panel title="توزيع الحصص اليومية" hint="مستوى استخدام كل طالب من حصته المجانية اليوم">
          <BarChart
            data={[
              { label: "0%", value: data.buckets.unused },
              { label: "1-25%", value: data.buckets.pct0 },
              { label: "25-50%", value: data.buckets.pct25 },
              { label: "50-75%", value: data.buckets.pct50 },
              { label: "75-100%", value: data.buckets.pct75 },
              { label: "100%+", value: data.buckets.pct100 },
            ]}
            empty="لا توجد بيانات حصص."
          />
        </Panel>
      </div>

      <Panel title={`مسار توليدات الدراسة اليومية — ${data.range}`} hint="جدول ai_usage_daily (الحصة study_generation)">
        {data.daily.every((d) => d.used === 0) ? (
          <EmptyState text="لا توجد توليدات مسجلة في هذه الفترة." />
        ) : (
          <DayBars days={data.daily.map((d) => ({ day: d.day, value: d.used }))} color="bg-purple-500/70" />
        )}
      </Panel>

      {data.topUsers.length > 0 && (
        <Panel title="أعلى مستهلكين للذكاء الاصطناعي" hint="حسب الحصص المستهلكة في النطاق">
          <BarChart data={data.topUsers.map((u) => ({ label: u.name, value: u.total }))} empty="لا توجد بيانات." />
        </Panel>
      )}

      <Panel title="التكلفة" hint="حسب ضبط أسعار التوكن في متغيرات البيئة">
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <CircleDollarSign className="h-4 w-4" />
          {data.costPricingConfigured
            ? "أسعار تكلفة التوكن مضبوطة — تُعرض أرقام الاستخدام فقط هنا."
            : "Token usage only — pricing not configured. (استخدام التوكنات فقط — أسعار التكلفة غير مضبوطة.)"}
        </p>
      </Panel>
    </div>
  );
}