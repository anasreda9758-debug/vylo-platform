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
  } catch {
    return legacyAiUsageToday(userId, now);
  }
}

/**
 * Atomically reserve one study-generation slot for the user (shared bucket
 * across flashcards, cases, practical, and case evaluation).
 *
 * Serializes concurrent reservations for the same (user, day, bucket) with an
 * advisory xact lock so exactly `limit` requests win; further requests return
 * limit_reached without consuming a slot. Falls back to a legacy
 * check-then-act when ai_usage_daily is not yet migrated.
 */
export async function reserveAiUsageSlot(
  userId: string,
  limit = FREE_DAILY_LIMIT,
  now = new Date(),
): Promise<QuotaReservation> {
  const dateKey = usageDateKey(now);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${dateKey}:${STUDY_GENERATION_BUCKET}`}))`,
      );
      const current = (await tx.execute(sql`
        SELECT count FROM ai_usage_daily
        WHERE user_id = ${userId}
          AND usage_date = ${dateKey}
          AND bucket = ${STUDY_GENERATION_BUCKET}
      `)) as { count?: number }[];
      const used = typeof current[0]?.count === "number" ? current[0].count : 0;
      if (used >= limit) return { ok: false, reason: "limit_reached" } as const;
      const after = (await tx.execute(sql`
        INSERT INTO ai_usage_daily (user_id, usage_date, bucket, count)
        VALUES (${userId}, ${dateKey}, ${STUDY_GENERATION_BUCKET}, 1)
        ON CONFLICT (user_id, usage_date, bucket)
        DO UPDATE SET count = ai_usage_daily.count + 1
        RETURNING count
      `)) as { count?: number }[];
      return { ok: true, count: typeof after[0]?.count === "number" ? after[0].count : used + 1 } as const;
    });
  } catch {
    // ai_usage_daily not yet migrated: legacy check-then-act against ai_usage.
    const used = await legacyAiUsageToday(userId, now);
    if (used >= limit) return { ok: false, reason: "limit_reached" };
    return { ok: true, count: used + 1 };
  }
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