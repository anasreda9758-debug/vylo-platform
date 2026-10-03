import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import { curriculumModule } from "../curriculum/schema";
import { academicPeriod } from "../hierarchy/schema";
import { promoCode, promoRedemption, plan } from "./schema";
import {
  MODULE_PRICE_EGP,
  MODULE_PRICE_CENTS,
  FULL_TERM_DISCOUNT_PERCENT,
  basePriceForScope,
  calculateDiscountCents,
  calculateFullTermPriceCents,
  calculateTermPriceCents,
  isBillableTermModule,
  promoAppliesToProduct,
  promoUsageError,
  REQUIREMENT_MODULE_SLUGS,
  ELECTIVE_PLACEHOLDER_SLUGS,
  isRequirementModule,
  isElectivePlaceholder,
  termNumberFromScopeRef,
  isSellablePlanScope,
  YEAR_PLAN_SCOPE,
  type PricingProduct,
} from "./pricing-rules";

export { MODULE_PRICE_EGP, MODULE_PRICE_CENTS, FULL_TERM_DISCOUNT_PERCENT, basePriceForScope, calculateDiscountCents, calculateFullTermPriceCents, calculateTermPriceCents, isBillableTermModule, promoAppliesToProduct, promoUsageError, REQUIREMENT_MODULE_SLUGS, ELECTIVE_PLACEHOLDER_SLUGS, isRequirementModule, isElectivePlaceholder, termNumberFromScopeRef, isSellablePlanScope, YEAR_PLAN_SCOPE };

/**
 * A plan is currently purchasable only when it is a sellable scope backed by
 * real, billable, published content: a medical module with at least one
 * lecture, or a term with an active period and at least one such module.
 * Requirement modules, elective placeholders, empty/unpublished modules, the
 * legacy year plan, and unknown scopes all return false.
 */
export async function isCurrentlyPurchasablePlan(selectedPlan: {
  id: string;
  scope: string;
  scopeRef: string | null;
}): Promise<boolean> {
  if (!isSellablePlanScope(selectedPlan.scope)) return false;
  if (selectedPlan.scope === "module") {
    if (!selectedPlan.scopeRef) return false;
    const moduleRow = await db.query.curriculumModule.findFirst({
      where: eq(curriculumModule.slug, selectedPlan.scopeRef),
      with: { lectures: { columns: { id: true }, limit: 1 } },
    });
    return Boolean(
      moduleRow && isBillableTermModule(moduleRow.slug) && moduleRow.lectures.length > 0,
    );
  }
  if (selectedPlan.scope === "term") {
    const termNumber = termNumberFromScopeRef(selectedPlan.scopeRef);
    if (termNumber === null) return false;
    const period = await db.query.academicPeriod.findFirst({
      where: and(eq(academicPeriod.type, `TERM_${termNumber}`), eq(academicPeriod.active, true)),
    });
    if (!period) return false;
    const termModules = await db.query.curriculumModule.findMany({
      where: eq(curriculumModule.term, termNumber),
      columns: { slug: true },
      with: { lectures: { columns: { id: true }, limit: 1 } },
    });
    const billableModules = termModules.filter((m) => isBillableTermModule(m.slug));
    return billableModules.length > 0 && billableModules.some((m) => m.lectures.length > 0);
  }
  return false;
}

export type PromoErrorCode =
  | "INVALID_CODE"
  | "CODE_EXPIRED"
  | "CODE_NOT_ACTIVE"
  | "CODE_USAGE_LIMIT"
  | "ALREADY_USED"
  | "CODE_NOT_VALID_FOR_PRODUCT";

export class PromoValidationError extends Error {
  constructor(public readonly code: PromoErrorCode) {
    super(code);
  }
}

type PromoRecord = Pick<
  typeof promoCode.$inferSelect,
  | "id"
  | "code"
  | "description"
  | "discountType"
  | "discountValue"
  | "appliesTo"
  | "moduleId"
  | "academicPeriodId"
  | "active"
  | "startsAt"
  | "expiresAt"
  | "maxUses"
  | "usedCount"
  | "maxUsesPerUser"
>;

export async function calculatePricePreview(input: {
  planId: string;
  promoCodeText?: string;
  userId?: string;
}) {
  const selectedPlan = await db.query.plan.findFirst({
    where: and(eq(plan.id, input.planId), eq(plan.active, true)),
  });
  if (!selectedPlan) throw new Error("PLAN_NOT_FOUND");

  if (!isSellablePlanScope(selectedPlan.scope)) throw new Error("PRODUCT_NOT_AVAILABLE");
  const termNumber = selectedPlan.scope === "term" ? termNumberFromScopeRef(selectedPlan.scopeRef) : null;
  let period: typeof academicPeriod.$inferSelect | undefined;
  let moduleCount = 1;
  let basePriceCents = MODULE_PRICE_CENTS;
  const product: PricingProduct = {
    id: selectedPlan.id,
    scope: selectedPlan.scope,
    scopeRef: selectedPlan.scopeRef,
  };
  if (selectedPlan.scope === "module" && selectedPlan.scopeRef) {
    const moduleRow = await db.query.curriculumModule.findFirst({
      where: eq(curriculumModule.slug, selectedPlan.scopeRef),
      with: {
        academicPeriod: true,
        lectures: { columns: { id: true }, limit: 1 },
      },
    });
    // A module is only purchasable when it is billable content that actually
    // exists. Never advertise an empty/unpublished module.
    if (!moduleRow || !isBillableTermModule(moduleRow.slug) || moduleRow.lectures.length === 0) {
      throw new Error("PRODUCT_NOT_AVAILABLE");
    }
    product.moduleId = moduleRow.id;
    period = moduleRow.academicPeriod ?? undefined;
    if (!period) throw new Error("ACADEMIC_PERIOD_NOT_CONFIGURED");
  } else if (termNumber !== null) {
    const periodType = `TERM_${termNumber}`;
    period = await db.query.academicPeriod.findFirst({
      where: and(eq(academicPeriod.type, periodType), eq(academicPeriod.active, true)),
    });
    const termModules = await db.query.curriculumModule.findMany({
      where: eq(curriculumModule.term, termNumber),
      columns: { slug: true },
      with: { lectures: { columns: { id: true }, limit: 1 } },
    });
    const billableModules = termModules.filter((m) => isBillableTermModule(m.slug));
    moduleCount = billableModules.length;
    // A term is only purchasable when it has at least one billable module with
    // published content.
    if (moduleCount === 0 || !billableModules.some((m) => m.lectures.length > 0)) {
      throw new Error("PRODUCT_NOT_AVAILABLE");
    }
    basePriceCents = calculateTermPriceCents(moduleCount).finalPriceCents;
  } else {
    throw new Error("PRODUCT_NOT_AVAILABLE");
  }
  product.academicPeriodId = period?.id ?? null;
  let discountAmountCents = 0;
  let promo: typeof promoCode.$inferSelect | null = null;

  if (input.promoCodeText?.trim()) {
    promo = await db.query.promoCode.findFirst({
      where: eq(promoCode.code, input.promoCodeText.trim().toUpperCase()),
    }) ?? null;
    if (!promo) throw new PromoValidationError("INVALID_CODE");
    await validatePromo(promo, product, input.userId);
    discountAmountCents = calculateDiscountCents(
      basePriceCents,
      promo.discountType,
      promo.discountValue,
    );
  }

  const finalPriceCents = Math.max(0, basePriceCents - discountAmountCents);
  const originalTotalCents =
    selectedPlan.scope === "term" ? moduleCount * MODULE_PRICE_CENTS : basePriceCents;
  const automaticDiscountCents =
    selectedPlan.scope === "term"
      ? calculateFullTermPriceCents(
          Array.from({ length: moduleCount }, () => MODULE_PRICE_CENTS),
        ).automaticDiscountCents
      : 0;
  return {
    planId: selectedPlan.id,
    originalPrice: originalTotalCents / 100,
    automaticDiscount: automaticDiscountCents / 100,
    basePrice: basePriceCents / 100,
    discountAmount: discountAmountCents / 100,
    finalPrice: finalPriceCents / 100,
    originalTotalCents,
    automaticDiscountCents,
    basePriceCents,
    discountAmountCents,
    finalPriceCents,
    // Single canonical amount a future checkout must charge.
    checkoutAmountCents: finalPriceCents,
    promoCode: promo?.code ?? null,
    expiresAt: period?.endsAt ?? null,
  };
}

async function validatePromo(
  promo: PromoRecord,
  product: PricingProduct,
  userId?: string,
) {
  const now = new Date();
  if (!promo.active) throw new PromoValidationError("CODE_NOT_ACTIVE");
  if (promo.startsAt && promo.startsAt > now) throw new PromoValidationError("CODE_NOT_ACTIVE");
  if (promo.expiresAt && promo.expiresAt <= now) throw new PromoValidationError("CODE_EXPIRED");
  const usageError = promoUsageError(promo.usedCount, promo.maxUses, 0, promo.maxUsesPerUser);
  if (usageError) throw new PromoValidationError(usageError);
  if (!promoAppliesToProduct(promo.appliesTo, product, promo.moduleId, promo.academicPeriodId)) {
    throw new PromoValidationError("CODE_NOT_VALID_FOR_PRODUCT");
  }
  if (userId) {
    const redemptions = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(promoRedemption)
      .where(and(eq(promoRedemption.promoCodeId, promo.id), eq(promoRedemption.userId, userId)));
    const usageError = promoUsageError(promo.usedCount, promo.maxUses, redemptions[0]?.count ?? 0, promo.maxUsesPerUser);
    if (usageError) throw new PromoValidationError(usageError);
  }
}

/**
 * Consume a code only after the payment/access transaction has succeeded.
 * The row lock and redemption check make max-use enforcement atomic.
 */
export async function redeemPromoCode(input: {
  code: string;
  userId: string;
  planId: string;
  paymentId?: string;
}) {
  return db.transaction(async (tx) => {
    const promoRows = await tx.execute(
      sql`SELECT * FROM "promo_code" WHERE code = ${input.code.trim().toUpperCase()} FOR UPDATE`,
    );
    const rawPromo = promoRows[0] as {
      id: string;
      code: string;
      description: string | null;
      discount_type: string;
      discount_value: number;
      applies_to: string;
      module_id: string | null;
      active: boolean;
      starts_at: Date | null;
      expires_at: Date | null;
      max_uses: number | null;
      used_count: number;
      max_uses_per_user: number;
      academic_period_id: string | null;
    } | undefined;
    const promo = rawPromo ? {
      id: rawPromo.id,
      code: rawPromo.code,
      description: rawPromo.description,
      discountType: rawPromo.discount_type,
      discountValue: rawPromo.discount_value,
      appliesTo: rawPromo.applies_to,
      moduleId: rawPromo.module_id,
      active: rawPromo.active,
      startsAt: rawPromo.starts_at,
      expiresAt: rawPromo.expires_at,
      maxUses: rawPromo.max_uses,
      usedCount: rawPromo.used_count,
      maxUsesPerUser: rawPromo.max_uses_per_user,
      academicPeriodId: rawPromo.academic_period_id,
    } : undefined;
    if (!promo) throw new PromoValidationError("INVALID_CODE");

    const selectedPlan = await tx.query.plan.findFirst({ where: eq(plan.id, input.planId) });
    if (!selectedPlan) throw new Error("PLAN_NOT_FOUND");
    if (!isSellablePlanScope(selectedPlan.scope)) throw new Error("PRODUCT_NOT_AVAILABLE");
    const product: PricingProduct = { id: selectedPlan.id, scope: selectedPlan.scope, scopeRef: selectedPlan.scopeRef };
    let redemptionPriceCents = MODULE_PRICE_CENTS;
    if (selectedPlan.scope === "module" && selectedPlan.scopeRef) {
      const moduleRow = await tx.query.curriculumModule.findFirst({
        where: eq(curriculumModule.slug, selectedPlan.scopeRef),
        with: {
          academicPeriod: true,
          lectures: { columns: { id: true }, limit: 1 },
        },
      });
      if (!moduleRow || !isBillableTermModule(moduleRow.slug) || moduleRow.lectures.length === 0) {
        throw new Error("PRODUCT_NOT_AVAILABLE");
      }
      product.moduleId = moduleRow.id;
      product.academicPeriodId = moduleRow.academicPeriod?.id ?? null;
    } else if (selectedPlan.scope === "term") {
      const termNumber = termNumberFromScopeRef(selectedPlan.scopeRef);
      if (termNumber === null) throw new Error("PRODUCT_NOT_AVAILABLE");
      const period = await tx.query.academicPeriod.findFirst({
        where: and(eq(academicPeriod.type, `TERM_${termNumber}`), eq(academicPeriod.active, true)),
      });
      if (!period) throw new Error("ACADEMIC_PERIOD_NOT_CONFIGURED");
      product.academicPeriodId = period.id;
      const termModules = await tx.query.curriculumModule.findMany({
        where: eq(curriculumModule.term, termNumber),
        columns: { slug: true },
        with: { lectures: { columns: { id: true }, limit: 1 } },
      });
      const billableModules = termModules.filter((m) => isBillableTermModule(m.slug));
      if (billableModules.length === 0 || !billableModules.some((m) => m.lectures.length > 0)) {
        throw new Error("PRODUCT_NOT_AVAILABLE");
      }
      redemptionPriceCents = calculateTermPriceCents(billableModules.length).finalPriceCents;
    } else {
      throw new Error("PRODUCT_NOT_AVAILABLE");
    }
    await validatePromoWithTx(tx, promo, product, input.userId);
    const discountAmountCents = calculateDiscountCents(redemptionPriceCents, promo.discountType, promo.discountValue);

    await tx.insert(promoRedemption).values({
      id: randomUUID(),
      promoCodeId: promo.id,
      userId: input.userId,
      paymentId: input.paymentId,
      discountAmountCents,
    });
    await tx.update(promoCode).set({ usedCount: sql`${promoCode.usedCount} + 1` }).where(eq(promoCode.id, promo.id));
    return { discountAmountCents, finalPriceCents: Math.max(0, redemptionPriceCents - discountAmountCents) };
  });
}

async function validatePromoWithTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], promo: PromoRecord, product: PricingProduct, userId: string) {
  const now = new Date();
  if (!promo.active) throw new PromoValidationError("CODE_NOT_ACTIVE");
  if (promo.startsAt && promo.startsAt > now) throw new PromoValidationError("CODE_NOT_ACTIVE");
  if (promo.expiresAt && promo.expiresAt <= now) throw new PromoValidationError("CODE_EXPIRED");
  const result = await tx.execute(sql`SELECT count(*)::int AS count FROM "promo_redemption" WHERE promo_code_id = ${promo.id} AND user_id = ${userId}`);
  const usageError = promoUsageError(promo.usedCount, promo.maxUses, Number((result[0] as { count: number }).count), promo.maxUsesPerUser);
  if (usageError) throw new PromoValidationError(usageError);
  if (!promoAppliesToProduct(promo.appliesTo, product, promo.moduleId, promo.academicPeriodId)) {
    throw new PromoValidationError("CODE_NOT_VALID_FOR_PRODUCT");
  }
}
