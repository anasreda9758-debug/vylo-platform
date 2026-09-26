import { sql } from "drizzle-orm";
import { db } from "@/shared/db";

export type GenerationFeature = "flashcard" | "case" | "tutor" | "practical";

export type IdempotencyState =
  | { kind: "new" }
  | { kind: "pending" }
  | { kind: "completed"; result: unknown }
  | { kind: "failed" };

/**
 * Idempotent generation entry point. Reusing the same (user, idempotencyKey,
 * feature) always yields the originally stored result, never a second
 * generation or a second quota charge. Serialization relies on the unique
 * (user_id, idempotency_key) index: a concurrent first insert loses and is
 * reported as pending.
 */
export async function beginGeneration(params: {
  userId: string;
  idempotencyKey: string;
  feature: GenerationFeature;
  lectureId?: string | null;
  practicalTrackId?: string | null;
}): Promise<IdempotencyState> {
  const rows = (await db.execute(sql`
    SELECT status, result_json FROM ai_generation_request
    WHERE user_id = ${params.userId} AND idempotency_key = ${params.idempotencyKey}
    LIMIT 1
  `)) as { status?: string; result_json?: string | null }[];
  if (rows.length === 0) {
    try {
      await db.execute(sql`
        INSERT INTO ai_generation_request
          (idempotency_key, user_id, feature, lecture_id, practical_track_id, status)
        VALUES (${params.idempotencyKey}, ${params.userId}, ${params.feature}, ${params.lectureId ?? null}, ${params.practicalTrackId ?? null}, 'pending')
      `);
      return { kind: "new" };
    } catch {
      // Concurrent first request won the insert; treat as pending.
      return { kind: "pending" };
    }
  }
  const row = rows[0];
  if (row.status === "completed") {
    if (row.result_json) {
      try {
        return { kind: "completed", result: JSON.parse(row.result_json) };
      } catch {
        return { kind: "completed", result: row.result_json };
      }
    }
    return { kind: "completed", result: null };
  }
  if (row.status === "pending") return { kind: "pending" };
  return { kind: "failed" };
}

export async function finalizeGeneration(params: {
  userId: string;
  idempotencyKey: string;
  status: "completed" | "failed";
  result?: unknown;
}) {
  await db.execute(sql`
    UPDATE ai_generation_request
    SET status = ${params.status},
        result_json = ${params.result === undefined ? null : JSON.stringify(params.result)},
        completed_at = ${params.status === "completed" ? new Date() : null}
    WHERE user_id = ${params.userId} AND idempotency_key = ${params.idempotencyKey}
  `);
}