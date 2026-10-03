import Link from "next/link";
import { db } from "@/shared/db";
import { getSession } from "@/shared/session";
import { getPlans, getActiveSubscriptions } from "@/features/billing/queries";
import { PurchaseButton } from "@/components/purchase-button";
import { Navigation } from "@/components/navigation";
import {
  Check,
  Crown,
  Calendar,
  Sparkles,
} from "lucide-react";
import { getLocale, localize } from "@/shared/locale";
import { moduleDescription } from "@/shared/curriculum-copy";
import { MODULE_PRICE_EGP, calculateFullTermPriceCents } from "@/features/billing/pricing";
import { SummerRetakePicker } from "@/components/summer-retake-picker";
import { getAcademicVisibility } from "@/features/hierarchy/academic-visibility-server";
import { filterAcademicModules } from "@/features/hierarchy/academic-visibility";
type PlanRow = {
  id: string;
  name: string;
  priceEg: number;
  durationDays: number;
  scope: string;
  scopeRef: string | null;
  originalPrice?: number;
  automaticDiscount?: number;
  expiresAt?: Date;
  moduleCount?: number;
};

function formatExpiry(date: Date, locale: "en" | "ar") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function PlanCard({
  plan,
  title,
  subtitle,
  highlight,
  owned,
  userId,
  features,
  locale,
}: {
  plan: PlanRow;
  title: string;
  subtitle?: string;
  highlight?: boolean;
  owned: boolean;
  userId?: string;
  features?: string[];
  locale: "en" | "ar";
}) {
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
        highlight
          ? "border-primary bg-gradient-to-b from-primary/5 to-transparent shadow-md"
          : "border-border bg-card"
      }`}
    >
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            <Crown className="h-3 w-3" />
            {t("Best value", "أفضل قيمة")}
          </span>
        </div>
      )}
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="mb-4">
        <span className="text-4xl font-bold">{plan.priceEg}</span>
        <span className="me-1 text-base font-medium text-muted-foreground">
          EGP
        </span>
      </div>
      {plan.automaticDiscount ? (
        <p className="mb-3 text-sm text-emerald-600">
          Save 20%: -{plan.automaticDiscount.toFixed(2)} EGP
          <span className="ms-1 text-muted-foreground">(original {plan.originalPrice?.toFixed(2)} EGP)</span>
        </p>
      ) : null}
      <p className="mb-4 text-sm text-muted-foreground">
        <Calendar className="me-1 inline h-3.5 w-3.5" />
        {plan.expiresAt
          ? t(`Access until ${formatExpiry(plan.expiresAt, "en")}`, `متاح حتى ${formatExpiry(plan.expiresAt, "ar")}`)
          : t("Access period configured by admin", "مدة الوصول محددة من الإدارة")}
      </p>
      {features && features.length > 0 && (
        <ul className="mb-6 space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto">
        {userId ? (
          <PurchaseButton
            planId={plan.id}
            priceEg={plan.priceEg}
            owned={owned}
          />
        ) : (
          <Link
            href="/sign-in"
            className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("Sign in to subscribe", "سجّل الدخول للاشتراك")}
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function PricingPage() {
  const session = await getSession();
  const locale = await getLocale();
  const t = (english: string, arabic: string) => localize(locale, english, arabic);
  const userId = session?.user.id;

  const [plans, loadedModules, periods, subs] = await Promise.all([
    getPlans(),
    db.query.curriculumModule.findMany({
      orderBy: (m, { asc }) => [asc(m.order)],
      with: {
        academicPeriod: true,
        lectures: { columns: { id: true }, limit: 1 },
      },
    }),
    db.query.academicPeriod.findMany({ where: (period, { eq }) => eq(period.active, true) }),
    userId ? getActiveSubscriptions(userId) : Promise.resolve([]),
  ]);

  const visibility = await getAcademicVisibility();
  const modules = filterAcademicModules(loadedModules, visibility, session?.user.role);
  const owned = new Set(
    subs.filter((s) => s.expiresAt > new Date()).map((s) => s.planId)
  );
  const moduleBySlug = new Map(modules.map((m) => [m.slug, m]));

  const periodByType = new Map(periods.map((period) => [period.type, period]));
  const summerPeriod = periods.find((period) => period.type === "SUMMER" && visibility.currentPeriodIds.has(period.id));
  const summerModules = modules.filter((module) => module.lectures.length > 0);
  const pricedPlans: PlanRow[] = plans
    .filter((p) => p.scope === "module" || p.scope === "term")
    .map((p) => {
      if (p.scope === "module") {
        const moduleRow = modules.find((item) => item.slug === p.scopeRef);
        return { ...p, priceEg: MODULE_PRICE_EGP, expiresAt: moduleRow?.academicPeriod?.endsAt };
      }
      const type = p.scopeRef === "1" ? "TERM_1" : "TERM_2";
      const period = periodByType.get(type);
      const moduleCount = period ? modules.filter((module) => module.academicPeriodId === period.id).length : 0;
      const term = calculateFullTermPriceCents(Array.from({ length: moduleCount }, () => MODULE_PRICE_EGP * 100));
      return {
        ...p,
        priceEg: term.finalPriceCents / 100,
        originalPrice: term.originalTotalCents / 100,
        automaticDiscount: term.automaticDiscountCents / 100,
        expiresAt: period?.endsAt,
        moduleCount,
      };
    });

  const nonCoreSlugs = new Set(["mt-104", "en-105", "uni-205"]);
  const pricedModulePlans = pricedPlans.filter((p) => p.scope === "module" && p.expiresAt);
  const pricedTermPlans = pricedPlans.filter((p) => p.scope === "term");
  const corePlans = pricedModulePlans.filter(
    (p) => !nonCoreSlugs.has(p.scopeRef ?? "")
  );
  const nonCorePlans = pricedModulePlans.filter((p) =>
    nonCoreSlugs.has(p.scopeRef ?? "")
  );

  return (
    <div className="flex flex-1">
      {session?.user ? (
        <Navigation
          user={{ name: session.user.name, email: session.user.email }}
          isAdmin={session.user.role === "admin"}
        />
      ) : null}

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-12 text-center">
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {t("Choose what fits you", "اختر ما يناسبك")}
            </span>
            <h1 className="mt-4 text-3xl font-bold lg:text-4xl">
              {t("Plans & subscription", "الأسعار والاشتراك")}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              {t("Choose a module for 149 EGP or unlock the full term with an automatic 20% saving. Term access covers every module in that academic period.", "اختر موديولًا بسعر 149 جنيه أو افتح الترم كاملًا مع خصم تلقائي 20٪. اشتراك الترم يشمل كل موديولات الفترة الدراسية.")}
            </p>
          </div>

          {/* Term Plans */}
          <section className="mb-12">
            <h2 className="mb-4 text-center text-xl font-bold">
              {t("Term subscriptions", "اشتراك الترم")}
            </h2>
            <p className="mb-6 text-center text-sm text-emerald-600">
              {t("Save 20% when you subscribe to the full term. Module count and price are calculated from the academic period.", "وفر 20% عند الاشتراك في الترم كاملًا. عدد الموديولات والسعر محسوبان من الفترة الدراسية.")}
            </p>
            <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
              {pricedTermPlans.filter((p) => (p.moduleCount ?? 0) > 0).map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  title={p.name}
                  subtitle={modules
                    .filter((module) => module.academicPeriodId === periodByType.get(p.scopeRef === "1" ? "TERM_1" : "TERM_2")?.id)
                    .map((module) => module.name)
                    .join(" · ")}
                  owned={owned.has(p.id)}
                  userId={userId}
                  locale={locale}
                  features={[
                    t("All modules in this academic period", "كل موديولات الفترة الدراسية"),
                    t("All lectures and practice", "جميع المحاضرات والتمارين"),
                    t("Question-bank quizzes", "اختبارات الأسئلة"),
                    t("Study tutor", "المعلم الذكي"),
                  ]}
                />
              ))}
            </div>
          </section>

          {summerPeriod && summerModules.length > 0 ? (
            <SummerRetakePicker
              modules={summerModules.map((module) => ({
                id: module.id,
                name: module.name,
                studyYear: module.studyYear,
                term: module.term,
              }))}
              endsAt={summerPeriod.endsAt}
            />
          ) : null}

          {/* Core Module Plans */}
          <section className="mb-12">
            <h2 className="mb-4 text-center text-xl font-bold">
              {t("Core modules", "الموديولات الأساسية")}
            </h2>
            <p className="mb-6 text-center text-sm text-muted-foreground">
              {t("149 EGP per module", "149 ج.م لكل موديول")}
            </p>
            <ul className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {corePlans.map((p) => {
                const m = moduleBySlug.get(p.scopeRef ?? "");
                return (
                  <li key={p.id}>
                    <PlanCard
                      plan={p}
                      title={m?.name ?? p.name}
                      subtitle={moduleDescription(m?.slug ?? p.scopeRef ?? "", m?.description ?? null, locale) ?? undefined}
                      owned={owned.has(p.id)}
                      userId={userId}
                      locale={locale}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Non-Core Module Plans */}
          {nonCorePlans.length > 0 && (
            <section className="mb-12">
              <h2 className="mb-4 text-center text-xl font-bold">
                {t("Additional modules", "المواد غير الأساسية")}
              </h2>
              <p className="mb-6 text-center text-sm text-muted-foreground">
                {t("149 EGP per module", "149 ج.م لكل موديول")}
              </p>
              <ul className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {nonCorePlans.map((p) => {
                  const m = moduleBySlug.get(p.scopeRef ?? "");
                  return (
                    <li key={p.id}>
                      <PlanCard
                        plan={p}
                        title={m?.name ?? p.name}
                        subtitle={moduleDescription(m?.slug ?? p.scopeRef ?? "", m?.description ?? null, locale) ?? undefined}
                        owned={owned.has(p.id)}
                        userId={userId}
                        locale={locale}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-center text-sm text-muted-foreground">
            {t("Prices are in Egyptian pounds. All content requires a subscription.", "الأسعار بالجنيه المصري. جميع المحتويات مدفوعة.")}
          </p>
        </div>
      </main>
    </div>
  );
}
