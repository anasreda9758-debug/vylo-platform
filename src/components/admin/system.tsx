"use client";

import type { ReactNode } from "react";
import { Server, Database, Bot, Mail, CreditCard, FolderKanban, ShieldCheck, RefreshCw, CircleCheck, CircleX } from "lucide-react";
import { useAdminData, formatDate } from "./use-admin-data";
import { Panel, Spinner, ErrorBox } from "./ui";
import type { SystemHealth } from "./types";

function BoolBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
      <CircleCheck className="h-4 w-4" />
      متصل
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-red-500">
      <CircleX className="h-4 w-4" />
      غير متصل
    </span>
  );
}

function Kvp({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

export function SystemTab() {
  const { data, loading, error, reload } = useAdminData<SystemHealth>("system");

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          حالة البيئة وقاعدة البيانات والمستودع — كل القيم مؤشرات وجود (booleans) ولا تكشف أي مفاتيح أو أسرار.
        </p>
        <button className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent" onClick={() => void reload()}>
          <RefreshCw className="h-3.5 w-3.5" />
          فحص الآن
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="خادم ووقت">
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            <Kvp label="التاريخ بتوقيت القاهرة" value={data.time.cairoDate} />
            <Kvp label="الوقت الحالي (UTC)" value={formatDate(data.time.now)} />
            <Kvp label="البيئة (NODE_ENV)" value={data.env.nodeEnv} />
            <Kvp label="رابط المنصة (BASE_URL)" value={data.env.baseUrlSet ? "مضبوط" : "غير مضبوط"} />
          </div>
        </Panel>

        <Panel title="قاعدة البيانات">
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-4 w-4" /> الاتصال</span>
              <BoolBadge ok={data.db.connected} />
            </div>
            <Kvp label="ترقيم الماجريشن" value={data.db.migrationCount ?? "—"} />
            {data.db.version && <Kvp label="إصدار Postgres" value={<span className="truncate" title={data.db.version}>{data.db.version}</span>} />}
          </div>
        </Panel>

        <Panel title="التحكم في الإصدارات">
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            <Kvp label="آخر commit" value={data.git.commit ? <span className="font-mono text-xs" dir="ltr">{data.git.commit}</span> : "—"} />
            <Kvp label="إجمالي commits" value={data.git.totalCommits ?? "—"} />
          </div>
        </Panel>

        <Panel title="التكاملات الخارجية" hint="مؤشرات فقط — لا تُعرض قيمة أي مفتاح">
          <div className="grid gap-2 p-4">
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><Bot className="h-4 w-4" /> الذكاء الاصطناعي ({data.integrations.ai.provider ?? "غير محدد"})</span>
              <BoolBadge ok={data.integrations.ai.groqKeySet} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><Mail className="h-4 w-4" /> البريد (Resend)</span>
              <BoolBadge ok={data.integrations.email.resendKeySet} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><CreditCard className="h-4 w-4" /> بوابة الدفع (Paymob)</span>
              <BoolBadge ok={data.integrations.payments.enabled} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><Server className="h-4 w-4" /> مجلد المحتوى (CONTENT_ROOT)</span>
              <BoolBadge ok={data.content.rootExists} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><FolderKanban className="h-4 w-4" /> مجلدات الصور في المحتوى</span>
              <span className="text-sm font-medium tabular-nums">{data.content.imageFolders ?? "—"}</span>
            </div>
          </div>
        </Panel>
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        الحالة تستخدم فحص وجود المفاتيح حصراً — لا تُكشف قيمة GROQ_API_KEY أو PAYMOB_HMAC_SECRET أو أي سر آخر في هذا العرض.
      </p>
    </div>
  );
}