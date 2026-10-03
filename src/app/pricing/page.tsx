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
} from "lucide-react";
import { getLocale, localize } from "@/shared/locale";
import {
  MODULE_PRICE_EGP,
  MODULE_PRICE_CENTS,
  calculateTermPriceCents,
  isBillableTermModule,
  isSellablePlanScope,
} from "@/features/billing/pricing";
import { SummerRetakePicker } from "@/components/summer-retake-picker";
import { getAcademicVisibility } from "@/features/hierarchy/academic-visibility-server";
import { filterAcademicModules } from "@/features/hierarchy/academic-visibility";

type PlanRow = {
  id: string;
  name: string;
  priceEg: number;
  priceCents: number;
  durationDays: number;
  scope: string;
  scopeRef: string | null;
  originalPrice?: number;
  automaticDiscount?: number;
  expiresAt?: Date;
  moduleCount?: number;
  purchaseAvailable?: boolean;
  pricePending?: boolean;
};

function formatExpiry(date: Date, locale: "en" | "ar") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMoney(amount: number, locale: "en" | "ar") {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {plan.purchaseAvailable
            ? t("Configured plan", "خطة مفعلة")
            : t("Pricing preview", "معاينة السعر")}
        </p>
        <h3 className="text-lg font-semibold">{title}</h3>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {plan.pricePending ? (
        <p className="mb-4 text-sm font-medium text-muted-foreground">
          {t("Final term price is pending confirmation.", "سعر الترم النهائي قيد التثبيت حاليًا.")}
        </p>
      ) : (
        <div className="mb-4">
          <span className="text-4xl font-bold">{formatMoney(plan.priceCents / 100, locale)}</span>
          <span className="me-1 text-base font-medium text-muted-foreground">
            EGP
          </span>
        </div>
      )}
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
          : t("Expiration date not configured", "تاريخ انتهاء الوصول غير محدد")}
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
        {plan.purchaseAvailable === false ? (
          <p className="rounded-xl bg-muted px-4 py-2.5 text-center text-sm text-muted-foreground">
            {t("Purchasing is not available yet.", "الشراء غير متاح حاليًا.")}
          </p>
        ) : userId ? (
          <PurchaseButton
            planId={plan.id}
            priceEg={plan.priceCents / 100}
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
  // Term pricing counts only eligible medical modules. Requirement modules and
  // elective placeholders never contribute to (or receive) a term price.
  const billableModules = modules.filter((module) => isBillableTermModule(module.slug));
  // Purchasable modules require an active term period AND published content.
  const availableModules = billableModules.filter(
    (module) =>
      module.academicPeriod?.active &&
      /^TERM_\d+$/.test(module.academicPeriod.type) &&
      module.lectures.length > 0,
  );
  // Only sellable plan scopes (module, term) are advertised. The legacy year
  // plan is excluded from every pricing surface even though it still exists
  // for already-held subscriptions.
  const sellablePlans = plans.filter((p) => isSellablePlanScope(p.scope));
  const modulePlansBySlug = new Map(
    sellablePlans.filter((p) => p.scope === "module").map((p) => [p.scopeRef, p]),
  );
  const termPlansByRef = new Map(
    sellablePlans.filter((p) => p.scope === "term").map((p) => [String(p.scopeRef), p]),
  );

  const periodByType = new Map(periods.map((period) => [period.type, period]));
  const summerPeriod = periods.find((period) => period.type === "SUMMER" && visibility.currentPeriodIds.has(period.id));
  const summerModules = modules.filter((module) => module.lectures.length > 0);

  // Individual module cards: only modules that already have a live term period
  // (i.e. content is reachable) and are billable medical modules.
  const moduleCards: PlanRow[] = availableModules.map((module) => {
    const configured = modulePlansBySlug.get(module.slug);
    return {
      ...(configured ?? {
        id: `module-${module.slug}`,
        name: module.name,
        durationDays: 0,
        scope: "module",
        scopeRef: module.slug,
      }),
      priceEg: MODULE_PRICE_EGP,
      priceCents: MODULE_PRICE_CENTS,
      expiresAt: module.academicPeriod?.endsAt,
      purchaseAvailable: Boolean(configured?.active),
    };
  });

  // Term cards for every term that has at least one eligible medical module.
  // All ten terms are represented; terms without configured plans or live
  // academic periods render as preview-only and stay impossible to purchase.
  const termNumbers = Array.from(new Set(billableModules.map((m) => m.term))).sort((a, b) => a - b);
  const termCards: PlanRow[] = termNumbers.flatMap((term) => {
    const termMedicalModules = billableModules.filter((module) => module.term === term);
    if (termMedicalModules.length === 0) return [];
    const hasContent = termMedicalModules.some((module) => module.lectures.length > 0);
    const total = calculateTermPriceCents(termMedicalModules.length);
    const configured = termPlansByRef.get(String(term));
    const period = periodByType.get(`TERM_${term}`);
    const pricePending = term === 10;
    return [{
      ...(configured ?? {
        id: `term-${term}`,
        name: t(`Term ${term}`, `الترم ${term}`),
        durationDays: 0,
        scope: "term",
        scopeRef: String(term),
      }),
      priceEg: pricePending ? 0 : total.finalPriceCents / 100,
      priceCents: pricePending ? 0 : total.finalPriceCents,
      originalPrice: pricePending ? 0 : total.originalTotalCents / 100,
      automaticDiscount: pricePending ? 0 : total.automaticDiscountCents / 100,
      expiresAt: period?.endsAt,
      moduleCount: termMedicalModules.length,
      purchaseAvailable: Boolean(configured?.active && period && hasContent),
      pricePending,
    }];
  });

  const pricedModulePlans = moduleCards;
  const pricedTermPlans = termCards;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {session?.user ? (
        <Navigation
          user={{ name: session.user.name, email: session.user.email }}
          isAdmin={session.user.role === "admin"}
        />
      ) : null}

      <main className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold lg:text-4xl">
              {t("Plans & Pricing", "الخطط والأسعار")}
            </h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
              {t(
                "Prices are calculated from the current curriculum. Purchase actions appear only for configured plans.",
                "تُحسب الأسعار من المنهج الحالي، ولا يظهر خيار الشراء إلا للخطط المفعلة.",
              )}
            </p>
          </div>

          {/* Term Plans */}
          <section className="mb-12">
            <h2 className="mb-4 text-center text-xl font-bold">
              {t("Term subscriptions", "اشتراك الترم")}
            </h2>
            <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
              {pricedTermPlans.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  title={p.name}
                  subtitle={billableModules
                    .filter((module) => String(module.term) === p.scopeRef)
                    .map((module) => module.name)
                    .join(" · ")}
                  owned={owned.has(p.id)}
                  userId={userId}
                  locale={locale}
                  features={[
                    t(`${p.moduleCount ?? 0} modules included`, `يشمل ${p.moduleCount ?? 0} موديولات`),
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

          {/* Individual module pricing */}
          <section className="mb-12">
            <h2 className="mb-4 text-center text-xl font-bold">
              {t("Individual modules", "الموديولات الفردية")}
            </h2>
            <p className="mb-6 text-center text-sm text-muted-foreground">
              {t("149 EGP per module", "149 ج.م لكل موديول")}
            </p>
            <ul className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pricedModulePlans.map((p) => {
                const m = moduleBySlug.get(p.scopeRef ?? "");
                return (
                  <li key={p.id}>
                    <PlanCard
                      plan={p}
                      title={m?.name ?? p.name}
                      subtitle={m ? t(`Term ${m.term}`, `الترم ${m.term}`) : undefined}
                      owned={owned.has(p.id)}
                      userId={userId}
                      locale={locale}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-center text-sm text-muted-foreground">
            {t("Prices are in Egyptian pounds. All content requires a subscription.", "الأسعار بالجنيه المصري. جميع المحتويات مدفوعة.")}
          </p>
        </div>
      </main>
    </div>
  );
}
