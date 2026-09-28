import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { academicPeriod } from "@/features/hierarchy/schema";
import { curriculumModule } from "@/features/curriculum/schema";
import { plan, promoCode, promoRedemption, subscription } from "@/features/billing/schema";
import { normalizeRedeemCode } from "@/features/billing/redeem-codes";
import { PromoValidationError } from "@/features/billing/pricing";
import { isBillableTermModule, termScopeRefFromType } from "@/features/billing/pricing-rules";

/**
 * TEMPORARY SECURITY KILL SWITCH.
 *
 * The `confirm` action creates a subscription and increments promo usage
 * directly, and can grant the wrong term or an unavailable module. Keep this
 * `false` until entitlement validation is implemented. The read-only `preview`
 * action below is intentionally unaffected.
 */
const PROMO_REDEMPTION_ENABLED = false;

const REDEMPTION_DISABLED_MESSAGE = "Promo code redemption is temporarily unavailable.";

function codeError(error: unknown) {
  if (!(error instanceof PromoValidationError)) return null;
  const messages: Record<string, string> = {
    INVALID_CODE: "Invalid code",
    CODE_EXPIRED: "Code expired",
    CODE_NOT_ACTIVE: "Code not active",
    CODE_USAGE_LIMIT: "Code usage limit reached",
    ALREADY_USED: "Already used by this account",
    CODE_NOT_VALID_FOR_PRODUCT: "Code not valid for this product",
  };
  return messages[error.code] ?? "Invalid code";
}

async function getLockedCode(code: string) {
  const rows = await db.execute(sql`SELECT * FROM "promo_code" WHERE code = ${normalizeRedeemCode(code)} FOR UPDATE`);
  return rows[0] as Record<string, unknown> | undefined;
}

async function validateCode(raw: Record<string, unknown> | undefined, userId: string) {
  if (!raw) throw new PromoValidationError("INVALID_CODE");
  const now = new Date();
  if (raw.active !== true) throw new PromoValidationError("CODE_NOT_ACTIVE");
  if (raw.starts_at && new Date(String(raw.starts_at)) > now) throw new PromoValidationError("CODE_NOT_ACTIVE");
  if (raw.expires_at && new Date(String(raw.expires_at)) <= now) throw new PromoValidationError("CODE_EXPIRED");
  if (raw.max_uses !== null && Number(raw.used_count) >= Number(raw.max_uses)) throw new PromoValidationError("CODE_USAGE_LIMIT");
  const existing = await db.select({ count: sql<number>`count(*)::int` }).from(promoRedemption)
    .where(and(eq(promoRedemption.promoCodeId, String(raw.id)), eq(promoRedemption.userId, userId)));
  if ((existing[0]?.count ?? 0) >= Number(raw.max_uses_per_user ?? 1)) throw new PromoValidationError("ALREADY_USED");
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { code?: unknown; action?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.code !== "string" || !body.code.trim()) return NextResponse.json({ error: "code is required" }, { status: 400 });
  const normalized = normalizeRedeemCode(body.code);
  if (normalized.length < 5 || normalized.length > 64) return NextResponse.json({ error: "Invalid code format" }, { status: 400 });

  // Authentication (401 above) is preserved before this response. Disable all
  // redemption writes without revealing anything about the account or code.
  if (body.action === "confirm" && !PROMO_REDEMPTION_ENABLED) {
    return NextResponse.json({ error: REDEMPTION_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    if (body.action !== "confirm") {
      const raw = await db.query.promoCode.findFirst({ where: eq(promoCode.code, normalized) });
      await validateCode(raw ? {
        id: raw.id, active: raw.active, starts_at: raw.startsAt, expires_at: raw.expiresAt,
        max_uses: raw.maxUses, used_count: raw.usedCount, max_uses_per_user: raw.maxUsesPerUser,
      } : undefined, session.user.id);
      const rewardType = raw?.rewardType ?? "PERCENTAGE_DISCOUNT";
      let benefit = rewardType.replaceAll("_", " ").toLowerCase();
      let accessUntil: Date | null = null;
      if (rewardType === "FREE_MODULE" && raw?.moduleId) {
        const moduleRow = await db.query.curriculumModule.findFirst({ where: eq(curriculumModule.id, raw.moduleId), with: { academicPeriod: true } });
        benefit = moduleRow ? `Free module access: ${moduleRow.name}` : "Free module access";
        accessUntil = raw.academicPeriodId ? (await db.query.academicPeriod.findFirst({ where: eq(academicPeriod.id, raw.academicPeriodId) }))?.endsAt ?? null : moduleRow?.academicPeriod?.endsAt ?? null;
      } else if (rewardType === "FREE_FULL_TERM" && raw?.academicPeriodId) {
        accessUntil = (await db.query.academicPeriod.findFirst({ where: eq(academicPeriod.id, raw.academicPeriodId) }))?.endsAt ?? null;
      }
      return NextResponse.json({ valid: true, code: formatDisplayCode(normalized), rewardType, benefit, accessUntil });
    }

    const result = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT * FROM "promo_code" WHERE code = ${normalized} FOR UPDATE`);
      const raw = rows[0] as Record<string, unknown> | undefined;
      await validateCode(raw, session.user.id);
      if (!raw) throw new PromoValidationError("INVALID_CODE");
      const rewardType = String(raw?.reward_type ?? "PERCENTAGE_DISCOUNT");
      if (!["FREE_MODULE", "FREE_FULL_TERM", "FREE_PURCHASE"].includes(rewardType)) {
        throw new PromoValidationError("CODE_NOT_VALID_FOR_PRODUCT");
      }
      const expiresAt = raw?.academic_period_id
        ? (await tx.query.academicPeriod.findFirst({ where: eq(academicPeriod.id, String(raw.academic_period_id)) }))?.endsAt
        : null;
      if (!expiresAt) throw new Error("REWARD_TARGET_NOT_CONFIGURED");
      if (rewardType === "FREE_MODULE") {
        const moduleRow = await tx.query.curriculumModule.findFirst({ where: eq(curriculumModule.id, String(raw?.module_id)), with: { academicPeriod: true } });
        if (moduleRow && !isBillableTermModule(moduleRow.slug)) throw new Error("REWARD_TARGET_NOT_CONFIGURED");
        const modulePlan = moduleRow ? await tx.query.plan.findFirst({ where: eq(plan.scopeRef, moduleRow.slug) }) : null;
        const moduleExpiry = expiresAt ?? moduleRow?.academicPeriod?.endsAt;
        if (!moduleRow || !modulePlan || !moduleExpiry) throw new Error("REWARD_TARGET_NOT_CONFIGURED");
        await tx.insert(subscription).values({ id: randomUUID(), userId: session.user.id, planId: modulePlan.id, status: "active", startsAt: new Date(), expiresAt: moduleExpiry });
      } else {
        const period = await tx.query.academicPeriod.findFirst({ where: eq(academicPeriod.id, String(raw.academic_period_id)) });
        const termScopeRef = termScopeRefFromType(period?.type ?? null);
        const termPlan = period && termScopeRef ? await tx.query.plan.findFirst({ where: and(eq(plan.scope, "term"), eq(plan.scopeRef, termScopeRef)) }) : null;
        if (!termPlan) throw new Error("REWARD_TARGET_NOT_CONFIGURED");
        await tx.insert(subscription).values({ id: randomUUID(), userId: session.user.id, planId: termPlan.id, status: "active", startsAt: new Date(), expiresAt });
      }
      await tx.insert(promoRedemption).values({ id: randomUUID(), promoCodeId: String(raw.id), userId: session.user.id, discountAmountCents: 0 });
      await tx.update(promoCode).set({ usedCount: sql`${promoCode.usedCount} + 1` }).where(eq(promoCode.id, String(raw.id)));
      return { redeemed: true, rewardType, expiresAt };
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = codeError(error);
    if (message) return NextResponse.json({ error: message }, { status: 400 });
    if (error instanceof Error && error.message === "REWARD_TARGET_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Code reward is not configured" }, { status: 400 });
    }
    console.error("[redeem]", error);
    return NextResponse.json({ error: "Unable to redeem code" }, { status: 500 });
  }
}

function formatDisplayCode(normalized: string) {
  return normalized.match(/.{1,5}/g)?.join("-") ?? normalized;
}
