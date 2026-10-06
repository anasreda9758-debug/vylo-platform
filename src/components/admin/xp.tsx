"use client";

import { Trophy, Zap, Flame, Swords, Star } from "lucide-react";
import { useAdminData } from "./use-admin-data";
import { BarChart, DayBars, EmptyState, KpiCard, Panel, Spinner, ErrorBox, TableShell } from "./ui";
import type { RangeValue } from "./use-admin-data";
import type { XpResponse } from "./types";

export function XpTab({ range }: { range: RangeValue }) {
  const { data, loading, error } = useAdminData<XpResponse>("xp", { range });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={Zap} label="إجمالي XP" value={data.totals.totalXp.toLocaleString("ar-EG")} sub={`${data.totals.profiles} ملفات XP`} color="text-yellow-500 bg-yellow-50 dark:bg-yellow-950/40" />
        <KpiCard icon={Flame} label="سلاسل نشطة" value={data.totals.activeStreaks} sub={`متوسط ${data.totals.avgStreak} يوم`} color="text-orange-600 bg-orange-50 dark:bg-orange-950/40" />
        <KpiCard icon={Swords} label="معارك نجحت/خسرت" value={`${data.totals.battlesWon}/${data.totals.battlesLost}`} sub="battle wins/losses" color="text-red-600 bg-red-50 dark:bg-red-950/40" />
        <KpiCard icon={Star} label="للاعبين في النطاق" value={data.todayUsers.length} sub="أحداث XP للحساب اليوم" color="text-blue-600 bg-blue-50 dark:bg-blue-950/40" />
        <KpiCard icon={Trophy} label="القائد" value={data.leaderboard[0] ? `${data.leaderboard[0].name.split(" ")[0]}` : "—"} sub={data.leaderboard[0] ? `${data.leaderboard[0].level} level` : "لا يوجد نشاط"} color="text-purple-600 bg-purple-50 dark:bg-purple-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="توزيع نقاط XP حسب السبب" hint="مصادر النقاط الفعلية من قاعدة البيانات">
          {data.byReason.length === 0 ? (
            <EmptyState text="لا توجد أحداث XP بعد." />
          ) : (
            <BarChart data={data.byReason.map((r) => ({ label: r.reason, value: r.amount }))} empty="لا توجد بيانات." />
          )}
        </Panel>

        <Panel title={`منحنى XP اليومي — ${data.range}`}>
          {data.daily.every((d) => d.xp === 0) ? (
            <EmptyState text="لا توجد نقاط في هذه الفترة." />
          ) : (
            <DayBars days={data.daily.map((d) => ({ day: d.day, value: d.xp }))} color="bg-yellow-500/70" />
          )}
        </Panel>
      </div>

      <Panel title="متصدرو النقاط" hint="أعلى 10 مستخدمين بالنقاط الإجمالية — المحافل وسلاسل المواظبة تشمل الاحتياطات">
        {data.leaderboard.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">لا يوجد نشاط XP بعد.</p>
        ) : (
          <TableShell
            cols={[
              { key: "rank", label: "#", className: "text-center" },
              { key: "user", label: "المستخدم" },
              { key: "xp", label: "XP", className: "text-center" },
              { key: "level", label: "المستوى", className: "text-center" },
              { key: "streak", label: "السلاسل", className: "text-center" },
              { key: "battles", label: "المعارك", className: "text-center" },
            ]}
          >
            {data.leaderboard.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5 text-center tabular-nums">{u.rank}</td>
                <td className="px-4 py-2.5 font-medium">{u.name}</td>
                <td className="px-4 py-2.5 text-center tabular-nums font-semibold">{u.totalXp.toLocaleString("ar-EG")}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{u.level}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{u.streak}</td>
                <td className="px-4 py-2.5 text-center tabular-nums">{u.battlesWon}/{u.battlesLost}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Panel>
    </div>
  );
}