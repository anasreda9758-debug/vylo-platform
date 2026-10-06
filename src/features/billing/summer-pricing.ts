import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/shared/db";
import { curriculumModule } from "../curriculum/schema";
import { academicPeriod } from "../hierarchy/schema";
import { promoCode, promoRedemption, summerAccess } from "./schema";
import {
  calculateDiscountCents,
  calculateSummerPriceCents,
  promoAppliesToProduct,
  promoUsageError,
  type PricingProduct,
} from "./pricing-rules";
import { PromoValidationError } from "./pricing";

export async function calculateSummerPreview(input: {
  moduleIds: string[];
  promoCodeText?: string;
  userId?: string;
}) {
  const moduleIds = [...new Set(input.moduleIds)];
  if (moduleIds.length === 0) throw new Error("NO_SUMMER_MODULES_SELECTED");

  const session = await db.query.academicPeriod.findFirst({
    where: and(eq(academicPeriod.type, "SUMMER"), eq(academicPeriod.active, true)),
  });
  if (!session) throw new Error("SUMMER_NOT_ACTIVE");
  const now = new Date();
  if (session.startsAt > now || session.endsAt <= now) throw new Error("SUMMER_NOT_ACTIVE");

  const modules = await db.query.curriculumModule.findMany({
    where: inArray(curriculumModule.id, moduleIds),
    with: { lectures: { columns: { id: true }, limit: 1 } },
  });
  if (modules.length !== moduleIds.length) throw new Error("INVALID_SUMMER_MODULE");
  if (modules.some((module) => module.lectures.length === 0)) {
    throw new Error("MODULE_NOT_PUBLISHED");
  }
  if (input.userId) {
    const existingAccess = await db.query.summerAccess.findMany({
      where: and(
        eq(summerAccess.userId, input.userId),
        inArray(summerAccess.moduleId, moduleIds),
        gt(summerAccess.expiresAt, new Date()),
      ),
      columns: { moduleId: true },
    });
    if (existingAccess.length > 0) throw new Error("SUMMER_ACCESS_ALREADY_ACTIVE");
  }

  const basePriceCents = calculateSummerPriceCents(modules.length);
  const product: PricingProduct = {
    id: `summer:${session.id}`,
    scope: "module",
    scopeRef: null,
    moduleId: modules.length === 1 ? modules[0].id : null,
    academicPeriodId: session.id,
  };
  let discountAmountCents = 0;
  let appliedPromo: typeof promoCode.$inferSelect | null = null;
  if (input.promoCodeText?.trim()) {
    appliedPromo = await db.query.promoCode.findFirst({
      where: eq(promoCode.code, input.promoCodeText.trim().toUpperCase()),
    }) ?? null;
    if (!appliedPromo) throw new PromoValidationError("INVALID_CODE");
    if (!promoAppliesToProduct(appliedPromo.appliesTo, product, appliedPromo.moduleId, null)) {
      throw new PromoValidationError("CODE_NOT_VALID_FOR_PRODUCT");
    }
    if (appliedPromo.appliesTo === "FULL_TERM" || appliedPromo.appliesTo === "SEMESTER") {
      throw new PromoValidationError("CODE_NOT_VALID_FOR_PRODUCT");
    }
    if (!appliedPromo.active) throw new PromoValidationError("CODE_NOT_ACTIVE");
    if (appliedPromo.startsAt && appliedPromo.startsAt > now) throw new PromoValidationError("CODE_NOT_ACTIVE");
    if (appliedPromo.expiresAt && appliedPromo.expiresAt <= now) throw new PromoValidationError("CODE_EXPIRED");
    if (appliedPromo.moduleId && (modules.length !== 1 || appliedPromo.moduleId !== modules[0].id)) {
      throw new PromoValidationError("CODE_NOT_VALID_FOR_PRODUCT");
    }
    const redemptionCount = input.userId
      ? await db.select({ count: sql<number>`count(*)::int` })
        .from(promoRedemption)
        .where(and(eq(promoRedemption.promoCodeId, appliedPromo.id), eq(promoRedemption.userId, input.userId)))
      : [{ count: 0 }];
    const usageError = promoUsageError(
      appliedPromo.usedCount,
      appliedPromo.maxUses,
      redemptionCount[0]?.count ?? 0,
      appliedPromo.maxUsesPerUser,
    );
    if (usageError) throw new PromoValidationError(usageError);
    discountAmountCents = calculateDiscountCents(basePriceCents, appliedPromo.discountType, appliedPromo.discountValue);
  }

  return {
    sessionId: session.id,
    modules: modules.map((module) => ({
      id: module.id,
      name: module.name,
      studyYear: module.studyYear,
      term: module.term,
    })),
    moduleCount: modules.length,
    basePriceCents,
    discountAmountCents,
    finalPriceCents: Math.max(0, basePriceCents - discountAmountCents),
    promoCode: appliedPromo?.code ?? null,
    expiresAt: session.endsAt,
  };
}
