import { egpToCents } from "./money";

export const MODULE_PRICE_EGP = 149;
export const MODULE_PRICE_CENTS = egpToCents(MODULE_PRICE_EGP);
export const FULL_TERM_DISCOUNT_PERCENT = 20;

/**
 * The legacy all-modules "academic year" plan. It is no longer sold by any
 * new-sale path: existing subscriptions keep working (see `queries.ts`), but
 * purchase/checkout/activation/promos reject it explicitly.
 */
export const YEAR_PLAN_SCOPE = "year";

/** Plan scopes that may still be sold to students. */
export const SELLABLE_PLAN_SCOPES = new Set(["module", "term"]);

export function isSellablePlanScope(scope: string): boolean {
  return SELLABLE_PLAN_SCOPES.has(scope);
}

/** Highest academic term number the platform models (TERM_1 … TERM_10). */
export const MAX_TERM_NUMBER = 10;

// University/faculty requirements are not medical modules and are excluded
// from term pricing. They are surfaced in their own section in the curriculum.
export const REQUIREMENT_MODULE_SLUGS = new Set(["mt-104", "en-105", "uni-205"]);
// Unspecified elective placeholders (no curriculum content yet). Not charged.
export const ELECTIVE_PLACEHOLDER_SLUGS = new Set(["e-1", "e-2", "e-3", "e-4"]);

export function isRequirementModule(slug: string): boolean {
  return REQUIREMENT_MODULE_SLUGS.has(slug);
}

export function isElectivePlaceholder(slug: string): boolean {
  return ELECTIVE_PLACEHOLDER_SLUGS.has(slug);
}

/**
 * A module that contributes to the discounted term price. Requirement modules
 * and unspecified elective placeholders are never counted (or charged).
 */
export function isBillableTermModule(slug: string): boolean {
  return !isRequirementModule(slug) && !isElectivePlaceholder(slug);
}

export type PricingProduct = {
  id: string;
  scope: string;
  scopeRef: string | null;
  moduleId?: string | null;
  academicPeriodId?: string | null;
};

export function basePriceForScope(scope: string): number | null {
  if (scope === "module") return MODULE_PRICE_EGP;
  return null;
}

export function basePriceCentsForScope(scope: string): number | null {
  if (scope === "module") return MODULE_PRICE_CENTS;
  return null;
}

/** `TERM_3` → `3`. Returns null for anything that is not TERM_1 … TERM_10. */
export function termNumberFromType(type: string | null | undefined): number | null {
  if (!type) return null;
  const match = /^TERM_(\d+)$/.exec(type);
  if (!match) return null;
  const term = Number(match[1]);
  if (!Number.isInteger(term) || term < 1 || term > MAX_TERM_NUMBER) return null;
  return term;
}

/** `3` → `TERM_3`. Returns null outside 1 … MAX_TERM_NUMBER. */
export function termTypeFromNumber(term: number): string | null {
  if (!Number.isInteger(term) || term < 1 || term > MAX_TERM_NUMBER) return null;
  return `TERM_${term}`;
}

/** Plan `scope_ref` for a term plan is the bare term number, e.g. `"3"`. */
export function termNumberFromScopeRef(scopeRef: string | null | undefined): number | null {
  if (scopeRef === null || scopeRef === undefined) return null;
  if (!/^\d+$/.test(scopeRef)) return null;
  const term = Number(scopeRef);
  if (!Number.isInteger(term) || term < 1 || term > MAX_TERM_NUMBER) return null;
  return term;
}

/** Academic-period `type` → plan `scope_ref` (bare term number). */
export function termScopeRefFromType(type: string | null | undefined): string | null {
  const term = termNumberFromType(type);
  return term === null ? null : String(term);
}

export function calculateFullTermPriceCents(modulePricesCents: number[]) {
  const originalTotalCents = modulePricesCents.reduce((total, price) => total + price, 0);
  const discountCents = Math.round((originalTotalCents * FULL_TERM_DISCOUNT_PERCENT) / 100);
  return {
    originalTotalCents,
    automaticDiscountCents: discountCents,
    finalPriceCents: Math.max(0, originalTotalCents - discountCents),
  };
}

/**
 * Term price = eligible medical modules × 149 EGP, less the 20% full-term
 * discount. All amounts are in minor units (piasters, EGP × 100).
 */
export function calculateTermPriceCents(moduleCount: number) {
  if (!Number.isInteger(moduleCount) || moduleCount < 0) {
    throw new Error("INVALID_TERM_MODULE_COUNT");
  }
  return calculateFullTermPriceCents(
    Array.from({ length: moduleCount }, () => MODULE_PRICE_CENTS),
  );
}

export function calculateSummerPriceCents(moduleCount: number) {
  if (!Number.isInteger(moduleCount) || moduleCount < 0) {
    throw new Error("INVALID_SUMMER_MODULE_COUNT");
  }
  return moduleCount * MODULE_PRICE_CENTS;
}

export function calculateDiscountCents(basePriceCents: number, discountType: string, discountValue: number) {
  if (discountType === "PERCENTAGE") {
    return Math.min(basePriceCents, Math.round((basePriceCents * discountValue) / 100));
  }
  return Math.min(basePriceCents, Math.max(0, discountValue * 100));
}

export function promoAppliesToProduct(
  appliesTo: string,
  product: PricingProduct,
  moduleId: string | null,
  academicPeriodId?: string | null,
) {
  return !(
    appliesTo === "FULL_TERM" && product.scope !== "term" ||
    appliesTo === "SEMESTER" && product.scope !== "term" ||
    appliesTo === "MODULE" && (product.scope !== "module" || (moduleId && moduleId !== product.moduleId)) ||
    academicPeriodId !== null && academicPeriodId !== undefined && academicPeriodId !== product.academicPeriodId
  );
}

export function promoUsageError(
  usedCount: number,
  maxUses: number | null,
  userRedemptions: number,
  maxUsesPerUser: number,
) {
  if (maxUses !== null && usedCount >= maxUses) return "CODE_USAGE_LIMIT";
  if (userRedemptions >= maxUsesPerUser) return "ALREADY_USED";
  return null;
}
