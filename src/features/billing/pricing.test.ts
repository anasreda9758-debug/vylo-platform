import { describe, expect, it } from "vitest";
import {
  MODULE_PRICE_EGP,
  MODULE_PRICE_CENTS,
  FULL_TERM_DISCOUNT_PERCENT,
  MAX_TERM_NUMBER,
  calculateFullTermPriceCents,
  calculateTermPriceCents,
  calculateSummerPriceCents,
  calculateDiscountCents,
  basePriceForScope,
  isBillableTermModule,
  isRequirementModule,
  isElectivePlaceholder,
  isSellablePlanScope,
  YEAR_PLAN_SCOPE,
  promoAppliesToProduct,
  promoUsageError,
  termNumberFromScopeRef,
  termNumberFromType,
  termScopeRefFromType,
  termTypeFromNumber,
} from "./pricing-rules";

describe("VYLO pricing and promo rules", () => {
  it("uses the VYLO module and semester prices", () => {
    expect(MODULE_PRICE_EGP).toBe(149);
    expect(basePriceForScope("module")).toBe(149);
    expect(basePriceForScope("term")).toBeNull();
  });

  it("only sells module and term scopes, never the legacy year plan", () => {
    expect(isSellablePlanScope("module")).toBe(true);
    expect(isSellablePlanScope("term")).toBe(true);
    expect(isSellablePlanScope(YEAR_PLAN_SCOPE)).toBe(false);
    expect(isSellablePlanScope("year")).toBe(false);
    expect(isSellablePlanScope("summer")).toBe(false);
    expect(isSellablePlanScope("")).toBe(false);
  });

  it("calculates dynamic full-term prices for any module count", () => {
    expect(FULL_TERM_DISCOUNT_PERCENT).toBe(20);
    expect(calculateFullTermPriceCents([14900, 14900, 14900]).finalPriceCents).toBe(35760);
    expect(calculateFullTermPriceCents([14900, 14900, 14900, 14900]).finalPriceCents).toBe(47680);
    expect(calculateFullTermPriceCents([14900, 14900, 14900, 14900, 14900]).finalPriceCents).toBe(59600);
  });

  it("prices a term from its eligible medical module count", () => {
    expect(calculateTermPriceCents(3).finalPriceCents).toBe(35760);
    expect(calculateTermPriceCents(4).finalPriceCents).toBe(47680);
    expect(calculateTermPriceCents(5).finalPriceCents).toBe(59600);
    expect(calculateTermPriceCents(0).finalPriceCents).toBe(0);
    expect(() => calculateTermPriceCents(-1)).toThrow("INVALID_TERM_MODULE_COUNT");
  });

  it("excludes requirements and elective placeholders from term pricing", () => {
    expect(isRequirementModule("mt-104")).toBe(true);
    expect(isRequirementModule("en-105")).toBe(true);
    expect(isRequirementModule("uni-205")).toBe(true);
    expect(isElectivePlaceholder("e-1")).toBe(true);
    expect(isElectivePlaceholder("e-4")).toBe(true);
    expect(isBillableTermModule("ahe-101")).toBe(true);
    expect(isBillableTermModule("git-301")).toBe(true);
    expect(isBillableTermModule("gp-10")).toBe(true);
    expect(isBillableTermModule("mt-104")).toBe(false);
    expect(isBillableTermModule("en-105")).toBe(false);
    expect(isBillableTermModule("uni-205")).toBe(false);
    expect(isBillableTermModule("e-2")).toBe(false);
  });

  it("prices Summer retakes module-by-module without a term discount", () => {
    expect(calculateSummerPriceCents(1)).toBe(14900);
    expect(calculateSummerPriceCents(2)).toBe(29800);
    expect(calculateSummerPriceCents(3)).toBe(44700);
    expect(promoAppliesToProduct("FULL_TERM", {
      id: "summer:session",
      scope: "module",
      scopeRef: null,
      academicPeriodId: "summer-session",
    }, null)).toBe(false);
    expect(promoAppliesToProduct("ANY", {
      id: "summer:session",
      scope: "module",
      scopeRef: null,
      academicPeriodId: "summer-session",
    }, null)).toBe(true);
  });

  it("calculates VYLOSTART at 10 percent", () => {
    expect(calculateDiscountCents(47680, "PERCENTAGE", 10)).toBe(4768);
  });

  it("calculates VYLOSEM50 at 50 EGP for a semester", () => {
    expect(calculateDiscountCents(47680, "FIXED_EGP", 50)).toBe(5000);
    expect(promoAppliesToProduct("FULL_TERM", { id: "term-1", scope: "term", scopeRef: "1" }, null)).toBe(true);
    expect(promoAppliesToProduct("SEMESTER", { id: "module-1", scope: "module", scopeRef: "m1" }, null)).toBe(false);
  });

  it("supports module-specific codes and rejects other modules", () => {
    expect(promoAppliesToProduct("MODULE", { id: "module-1", scope: "module", scopeRef: "m1", moduleId: "m1" }, "m1")).toBe(true);
    expect(promoAppliesToProduct("MODULE", { id: "module-2", scope: "module", scopeRef: "m2", moduleId: "m2" }, "m1")).toBe(false);
  });

  it("never produces a negative final price", () => {
    const discount = calculateDiscountCents(1000, "FIXED_EGP", 50);
    expect(Math.max(0, 1000 - discount)).toBe(0);
    expect(calculateDiscountCents(1000, "PERCENTAGE", 100)).toBe(1000);
  });

  it("enforces inactive/expired and usage decisions without consuming a preview", () => {
    expect(promoUsageError(100, 100, 0, 1)).toBe("CODE_USAGE_LIMIT");
    expect(promoUsageError(1, 100, 1, 1)).toBe("ALREADY_USED");
    expect(promoUsageError(1, 100, 0, 1)).toBeNull();
    expect(promoUsageError(0, null, 0, 1)).toBeNull();
  });

  it("uses integer piasters for the canonical module price", () => {
    expect(MODULE_PRICE_CENTS).toBe(14900);
    expect(calculateTermPriceCents(1).finalPriceCents).toBe(11920);
    expect(calculateTermPriceCents(6).finalPriceCents).toBe(71520);
    expect(calculateTermPriceCents(10).finalPriceCents).toBe(119200);
  });

  it("maps every term 1-10 consistently across scopes", () => {
    expect(MAX_TERM_NUMBER).toBe(10);
    expect(termTypeFromNumber(1)).toBe("TERM_1");
    expect(termTypeFromNumber(3)).toBe("TERM_3");
    expect(termTypeFromNumber(10)).toBe("TERM_10");
    expect(termTypeFromNumber(0)).toBeNull();
    expect(termTypeFromNumber(11)).toBeNull();

    expect(termNumberFromType("TERM_7")).toBe(7);
    expect(termNumberFromType("TERM_10")).toBe(10);
    expect(termNumberFromType("SUMMER")).toBeNull();
    expect(termNumberFromType(null)).toBeNull();

    expect(termNumberFromScopeRef("3")).toBe(3);
    expect(termNumberFromScopeRef("10")).toBe(10);
    expect(termNumberFromScopeRef("0")).toBeNull();
    expect(termNumberFromScopeRef("abc")).toBeNull();

    expect(termScopeRefFromType("TERM_5")).toBe("5");
    expect(termScopeRefFromType("SUMMER")).toBeNull();
  });

  it("applies full-term codes to later terms but not to the wrong period", () => {
    const term5 = { id: "term-5", scope: "term", scopeRef: "5", academicPeriodId: "p5" };
    expect(promoAppliesToProduct("FULL_TERM", term5, null)).toBe(true);
    expect(promoAppliesToProduct("FULL_TERM", term5, null, "p5")).toBe(true);
    expect(promoAppliesToProduct("FULL_TERM", term5, null, "p1")).toBe(false);
    expect(promoAppliesToProduct("MODULE", term5, null)).toBe(false);
  });
});
