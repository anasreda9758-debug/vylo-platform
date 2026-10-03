import { and, asc, desc, eq, gt, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import { plan, subscription, summerAccess } from "./schema";
import { user } from "../auth/schema";
import { academicPeriod } from "../hierarchy/schema";
import { curriculumModule } from "../curriculum/schema";
import { egpToCents } from "./money";
import { ActivationError, decideActivation, type ActivationOutcome } from "./activation";
import { isSellablePlanScope, termNumberFromScopeRef, termTypeFromNumber } from "./pricing-rules";

export const GRACE_PERIOD_DAYS = 3;

export type PlanWithPriceCents = typeof plan.$inferSelect & { priceCents: number };

/**
 * Cached probe for the additive `plan.price_cents` column. The column only
 * exists after migration 0022 is applied, so the app must keep working before
 * then by falling back to `price_eg * 100`. Cached because the answer cannot
 * change without a restart in practice; tests reset it explicitly.
 */
let planCentsColumnAvailable: boolean | null = null;

export function resetPlanCentsColumnProbe(): void {
  planCentsColumnAvailable = null;
}

async function hasPlanCentsColumn(): Promise<boolean> {
  if (planCentsColumnAvailable !== null) return planCentsColumnAvailable;
  try {
    const rows = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan' AND column_name = 'price_cents'
      LIMIT 1
    `);
    planCentsColumnAvailable = rows.length > 0;
  } catch {
    planCentsColumnAvailable = false;
  }
  return planCentsColumnAvailable;
}

async function loadPlanPriceCents(): Promise<Map<string, number> | null> {
  if (!(await hasPlanCentsColumn())) return null;
  try {
    const rows = await db.execute(sql`SELECT id, price_cents FROM "plan"`);
    const map = new Map<string, number>();
    for (const row of rows) {
      const record = row as { id?: unknown; price_cents?: unknown };
      if (typeof record.id === "string" && typeof record.price_cents === "number" && Number.isInteger(record.price_cents)) {
        map.set(record.id, record.price_cents);
      }
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Active plans with their price resolved to integer piasters. Uses the new
 * `price_cents` column when present, otherwise converts the legacy `price_eg`.
 */
export async function getPlans(): Promise<PlanWithPriceCents[]> {
  const plans = await db.query.plan.findMany({
    where: eq(plan.active, true),
    orderBy: (p) => [asc(p.scope), asc(p.priceEg)],
  });
  const cents = await loadPlanPriceCents();
  return plans.map((p) => ({
    ...p,
    priceCents: cents?.get(p.id) ?? egpToCents(p.priceEg),
  }));
}

export type ActiveSubscription = {
  id: string;
  planId: string;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  graceExpiresAt: Date | null;
  plan: {
    id: string;
    name: string;
    priceEg: number;
    durationDays: number;
    scope: string;
    scopeRef: string | null;
  };
};

/**
 * Get subscriptions that are active or in grace period.
 * Grace period: 3 days after expiry, user still has access but sees a renewal warning.
 */
export async function getActiveSubscriptions(userId: string): Promise<ActiveSubscription[]> {
  return db.query.subscription.findMany({
    where: and(
      eq(subscription.userId, userId),
      or(
        eq(subscription.status, "active"),
        eq(subscription.status, "grace"),
      ),
    ),
    with: { plan: true },
  });
}

/**
 * Get only strictly active subscriptions (not in grace period).
 */
export async function getStrictActiveSubscriptions(userId: string): Promise<ActiveSubscription[]> {
  return db.query.subscription.findMany({
    where: and(
      eq(subscription.userId, userId),
      eq(subscription.status, "active"),
    ),
    with: { plan: true },
  });
}

/**
 * Check if a subscription is currently within its grace period.
 */
export function isInGracePeriod(sub: ActiveSubscription): boolean {
  if (sub.status !== "grace") return false;
  if (!sub.graceExpiresAt) return false;
  return new Date() <= sub.graceExpiresAt;
}

/**
 * True when the user holds an active (or grace-period) subscription that covers the given module.
 * Year unlocks everything; term unlocks all modules of that term; module unlocks that module.
 */
export async function hasModuleAccess(
  userId: string,
  module: { id: string; slug: string; isFree: boolean; term: number },
) {
  if (module.isFree) return true;
  const subs = await getActiveSubscriptions(userId);
  const now = new Date();
  const summerRows = await db.query.summerAccess.findMany({
    where: and(eq(summerAccess.userId, userId), eq(summerAccess.moduleId, module.id)),
    columns: { expiresAt: true },
  });
  if (summerRows.some((row) => row.expiresAt > now)) return true;
  for (const s of subs) {
    // Skip expired (non-grace) subs
    if (s.status === "active") {
      // Active: check expiry AND that subscription has started
      if (s.expiresAt <= now) continue;
      if (s.startsAt > now) continue;
    } else if (s.status === "grace") {
      // Grace: check grace expiry
      if (!s.graceExpiresAt || s.graceExpiresAt <= now) continue;
    }
    const p = s.plan;
    if (p.scope === "year") return true;
    if (p.scope === "term" && String(p.scopeRef) === String(module.term)) return true;
    if (p.scope === "module" && p.scopeRef === module.slug) return true;
  }
  return false;
}

/**
 * True when the user holds ANY active subscription (used for AI limits).
 */
export async function hasAnySubscription(userId: string) {
  const subs = await getActiveSubscriptions(userId);
  const now = new Date();
  return subs.some((s) => {
    if (s.status === "active") return s.expiresAt > now && s.startsAt <= now;
    if (s.status === "grace") return s.graceExpiresAt && s.graceExpiresAt > now;
    return false;
  });
}

/**
 * Enrich every module with its resolved access flag.
 */
export async function withModuleAccess<T extends { id: string; slug: string; isFree: boolean; term: number }>(
  userId: string,
  modules: T[],
): Promise<(T & { access: boolean })[]> {
  const subs = await getActiveSubscriptions(userId);
  const now = new Date();
  const summerRows = await db.query.summerAccess.findMany({
    where: and(eq(summerAccess.userId, userId), gt(summerAccess.expiresAt, now)),
    columns: { moduleId: true },
  });
  const summerModuleSet = new Set(summerRows.map((row) => row.moduleId));

  const isCovered = (s: ActiveSubscription) => {
    if (s.status === "active" && s.expiresAt > now && s.startsAt <= now) return true;
    if (s.status === "grace" && s.graceExpiresAt && s.graceExpiresAt > now) return true;
    return false;
  };

  const hasYear = subs.some((s) => isCovered(s) && s.plan.scope === "year");
  const termSet = new Set(
    subs.filter((s) => isCovered(s) && s.plan.scope === "term").map((s) => String(s.plan.scopeRef)),
  );
  const moduleSet = new Set(
    subs.filter((s) => isCovered(s) && s.plan.scope === "module").map((s) => s.plan.scopeRef),
  );
  return modules.map((m) => ({
    ...m,
    access: m.isFree || hasYear || termSet.has(String(m.term)) || moduleSet.has(m.slug) || summerModuleSet.has(m.id),
  }));
}

export type ActivateSubscriptionResult = {
  plan: typeof plan.$inferSelect;
  subscriptionId: string;
  outcome: ActivationOutcome;
  expiresAt: Date;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resolvePlanPeriodEndsAt(tx: Tx, planRow: typeof plan.$inferSelect): Promise<Date | null> {
  if (planRow.scope === "module" && planRow.scopeRef) {
    const moduleRow = await tx.query.curriculumModule.findFirst({
      where: eq(curriculumModule.slug, planRow.scopeRef),
      with: { academicPeriod: true },
    });
    return moduleRow?.academicPeriod?.endsAt ?? null;
  }
  if (planRow.scope === "term") {
    const termNumber = termNumberFromScopeRef(planRow.scopeRef);
    const periodType = termNumber === null ? null : termTypeFromNumber(termNumber);
    if (!periodType) return null;
    const period = await tx.query.academicPeriod.findFirst({
      where: and(eq(academicPeriod.type, periodType), eq(academicPeriod.active, true)),
    });
    return period?.endsAt ?? null;
  }
  // `year` plans have no single academic period; activation is not supported
  // until the owner resolves year-plan pricing/period semantics.
  return null;
}

/**
 * Activate (or renew) a subscription for any supported plan scope
 * (module, or term 1 … term 10).
 *
 * Guarantees:
 * - Rent-only for sellable scopes: the legacy `year` plan is not activated here
 *   (existing year subscriptions keep working as entitlements).
 * - Serialized per user+plan (advisory lock) so concurrent/repeated activations
 *   cannot create duplicates.
 * - Never shortens existing access: the expiry only ever moves later.
 * - Renewal of an already-covered period is a no-op (`already-active`).
 *
 * Returns null when the plan does not exist or has no resolvable academic
 * period, or throws `ActivationError` when the plan is not sellable or the
 * period has ended.
 */
export async function activateSubscription(
  userId: string,
  planId: string,
): Promise<ActivateSubscriptionResult | null> {
  const planRow = await db.query.plan.findFirst({ where: eq(plan.id, planId) });
  if (!planRow) return null;
  if (!isSellablePlanScope(planRow.scope)) {
    throw new ActivationError("PLAN_SCOPE_NOT_SELLABLE");
  }

  const now = new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${planId}`}))`);

    const periodEndsAt = await resolvePlanPeriodEndsAt(tx, planRow);
    if (!periodEndsAt) return null;

    const existing = await tx
      .select({ id: subscription.id, expiresAt: subscription.expiresAt })
      .from(subscription)
      .where(
        and(
          eq(subscription.userId, userId),
          eq(subscription.planId, planId),
          or(eq(subscription.status, "active"), eq(subscription.status, "grace")),
        ),
      )
      .for("update");

    const decision = decideActivation({
      periodEndsAt,
      now,
      activeExpiries: existing.map((row) => row.expiresAt),
    });

    if (existing.length > 0 && decision.outcome !== "created") {
      const target = existing.reduce((a, b) => (b.expiresAt > a.expiresAt ? b : a));
      await tx
        .update(subscription)
        .set({
          expiresAt: decision.expiresAt,
          status: "active",
          graceExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(subscription.id, target.id));
      return {
        plan: planRow,
        subscriptionId: target.id,
        outcome: decision.outcome,
        expiresAt: decision.expiresAt,
      };
    }

    const id = randomUUID();
    await tx.insert(subscription).values({
      id,
      userId,
      planId,
      status: "active",
      startsAt: now,
      expiresAt: decision.expiresAt,
    });
    return {
      plan: planRow,
      subscriptionId: id,
      outcome: decision.outcome,
      expiresAt: decision.expiresAt,
    };
  });
}

/**
 * Move expired subscriptions to grace period (runs daily via cron).
 * Subscriptions that expired within the last GRACE_PERIOD_DAYS are moved to "grace".
 * Subscriptions past grace are marked "expired".
 */
export async function processExpiredSubscriptions(): Promise<{ movedToGrace: number; fullyExpired: number }> {
  const now = new Date();
  const graceDeadline = new Date(now);
  graceDeadline.setDate(graceDeadline.getDate() - GRACE_PERIOD_DAYS);

  // Active subs past expiry → move to grace
  const movedToGrace = await db
    .update(subscription)
    .set({
      status: "grace",
      graceExpiresAt: new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
      updatedAt: now,
    })
    .where(and(
      eq(subscription.status, "active"),
      lte(subscription.expiresAt, now),
    ))
    .returning();

  // Grace subs past grace deadline → fully expire
  const fullyExpired = await db
    .update(subscription)
    .set({ status: "expired", updatedAt: now })
    .where(and(
      eq(subscription.status, "grace"),
      lte(subscription.graceExpiresAt, now),
    ))
    .returning();

  return { movedToGrace: movedToGrace.length, fullyExpired: fullyExpired.length };
}

/**
 * Downgrade: cancel a specific subscription immediately (e.g., admin action or refund).
 */
export async function cancelSubscription(subscriptionId: string, userId: string) {
  await db
    .update(subscription)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(subscription.id, subscriptionId),
      eq(subscription.userId, userId),
    ));
}

export async function deactivateSubscription(userId: string) {
  await db
    .update(subscription)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(subscription.userId, userId), eq(subscription.status, "active")));
}

/**
 * Get subscription status summary for the user (for UI display).
 */
export async function getSubscriptionSummary(userId: string) {
  const subs = await getActiveSubscriptions(userId);
  const now = new Date();
  const active = subs.filter((s) => {
    if (s.status === "active") return s.expiresAt > now;
    if (s.status === "grace") return s.graceExpiresAt && s.graceExpiresAt > now;
    return false;
  });

  const inGrace = subs.filter((s) => s.status === "grace" && s.graceExpiresAt && s.graceExpiresAt > now);

  return {
    hasActive: active.length > 0,
    hasGrace: inGrace.length > 0,
    subscriptions: active,
    graceSubscriptions: inGrace,
  };
}

export async function listStudents() {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.role, "student"))
    .orderBy(desc(user.createdAt));
}

export async function getSubscriptionForUsers(userIds: string[]) {
  if (userIds.length === 0) return [];
  return db.query.subscription.findMany({
    where: (s, { and, eq, inArray }) =>
      and(inArray(s.userId, userIds), eq(s.status, "active")),
    with: { plan: true },
  });
}
