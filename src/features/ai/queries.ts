import { and, eq, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import { aiUsage } from "./schema";

export const FREE_DAILY_LIMIT = 15;
export const STUDY_GENERATION_BUCKET = "study_generation";

export type QuotaReservation =
  | { ok: true; count: number }
  | { ok: false; reason: "limit_reached" };

/** Cairo-timezone daily key (YYYY-MM-DD) that resets the shared quota bucket. */
export function usageDateKey(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function legacyAiUsageToday(userId: string, now = new Date()): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startOfDay)));
  return rows.length;
}

/**
 * The additive ai_usage_daily counter may not exist on pre-migration dbs. Only
 * that exact missing-relation failure may fall back; every other error must
 * propagate so the quota never fails open on a transient DB fault.
 */
function isMissingDailyTable(error: unknown): boolean {
  return (error as { code?: string })?.code === "42P01" &&
    /ai_usage_daily/.test(String((error as { message?: string })?.message ?? ""));
}

/**
 * Today's used study-generation operations for the user.
 * Prefers the additive ai_usage_daily counter; falls back to a legacy
 * ai_usage row-count when that table is not yet migrated.
 */
export async function getAiUsageToday(userId: string, now = new Date()): Promise<number> {
  try {
    const rows = (await db.execute(sql`
      SELECT count FROM ai_usage_daily
      WHERE user_id = ${userId}
        AND usage_date = ${usageDateKey(now)}
        AND bucket = ${STUDY_GENERATION_BUCKET}
    `)) as { count?: number }[];
    return typeof rows[0]?.count === "number" ? rows[0].count : 0;
  } catch (error) {
    if (!isMissingDailyTable(error)) throw error;
    return legacyAiUsageToday(userId, now);
  }
}

/**
 * Atomically reserve one study-generation slot for the user (shared bucket
 * across Tutor, flashcards, cases, practical, and hosted case evaluation).
 *
 * Serializes concurrent reservations for the same (user, day, bucket) with an
 * advisory xact lock so exactly `limit` requests win; further requests return
 * limit_reached without consuming a slot. A missing counter table or invalid
 * counter fails closed; legacy successful-usage rows cannot reserve paid work.
 * Provider failures/retries do not refund a reservation: they can still cost.
 */
export async function reserveAiUsageSlot(
  userId: string,
  limit = FREE_DAILY_LIMIT,
  now = new Date(),
): Promise<QuotaReservation> {
  if (!Number.isInteger(limit) || limit < 1 || limit > FREE_DAILY_LIMIT) {
    throw new Error("Invalid AI quota limit");
  }
  const dateKey = usageDateKey(now);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${dateKey}:${STUDY_GENERATION_BUCKET}`}))`,
    );
    const current = (await tx.execute(sql`
      SELECT count FROM ai_usage_daily
      WHERE user_id = ${userId}
        AND usage_date = ${dateKey}
        AND bucket = ${STUDY_GENERATION_BUCKET}
    `)) as { count?: number }[];
    const used = current.length === 0 ? 0 : current[0].count;
    if (typeof used !== "number" || !Number.isInteger(used) || used < 0) {
      throw new Error("Invalid AI quota counter");
    }
    if (used >= limit) return { ok: false, reason: "limit_reached" } as const;
    const after = (await tx.execute(sql`
      INSERT INTO ai_usage_daily (user_id, usage_date, bucket, count)
      VALUES (${userId}, ${dateKey}, ${STUDY_GENERATION_BUCKET}, 1)
      ON CONFLICT (user_id, usage_date, bucket)
      DO UPDATE SET count = ai_usage_daily.count + 1
      RETURNING count
    `)) as { count?: number }[];
    if (after[0]?.count !== used + 1) throw new Error("AI quota reservation was not confirmed");
    return { ok: true, count: after[0].count } as const;
  });
}

export async function recordAiUsage(params: {
  userId: string;
  lectureId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}) {
  await db.insert(aiUsage).values({
    id: randomUUID(),
    userId: params.userId,
    lectureId: params.lectureId,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  });
}
