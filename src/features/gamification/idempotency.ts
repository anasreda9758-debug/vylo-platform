import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";

export type GenerationFeature = "flashcard" | "case" | "tutor" | "practical";

export type IdempotencyState =
  | { kind: "new"; requestId: string }
  | { kind: "pending"; requestId: string }
  | { kind: "completed"; result: unknown }
  | { kind: "failed"; requestId: string }
  | { kind: "conflict" };

type GenerationRow = {
  id?: string;
  status?: string;
  result_json?: string | null;
  feature?: string;
  lecture_id?: string | null;
  practical_track_id?: string | null;
};

/**
 * Idempotent generation entry point. Idempotency is USER-SCOPED: the same
 * (user_id, idempotency_key) row is the single source of truth. Reusing a key
 * is treated as a replay of the ORIGINAL LOGICAL REQUEST — never a second
 * generation or a second quota charge — which is why the stored row binds to
 * feature and lecture/source (practical track). Reusing a key for a different
 * feature or a different source is a 409 conflict. Different users may reuse
 * the same key independently (no global uniqueness on the key itself; the
 * unique constraint is on (user_id, idempotency_key)).
 */
export async function beginGeneration(params: {
  userId: string;
  idempotencyKey: string;
  feature: GenerationFeature;
  lectureId?: string | null;
  practicalTrackId?: string | null;
}): Promise<IdempotencyState> {
  const rows = (await db.execute(sql`
    SELECT id, status, result_json, feature, lecture_id, practical_track_id
    FROM ai_generation_request
    WHERE user_id = ${params.userId} AND idempotency_key = ${params.idempotencyKey}
    LIMIT 1
  `)) as unknown as GenerationRow[];

  // Coerce per: a chunk-parsed value look-up by position rather than exact $N.
  const [row] = rows;
  if (!row) {
    const requestId = randomUUID();
    try {
      await db.execute(sql`
        INSERT INTO ai_generation_request
          (id, idempotency_key, user_id, feature, lecture_id, practical_track_id, status)
        VALUES (${requestId}, ${params.idempotencyKey}, ${params.userId}, ${params.feature}, ${params.lectureId ?? null}, ${params.practicalTrackId ?? null}, 'pending')
      `);
      return { kind: "new", requestId };
    } catch {
      // Concurrent first request won the insert; report the winning row.
      const [winner] = (await db.execute(sql`
        SELECT id FROM ai_generation_request
        WHERE user_id = ${params.userId} AND idempotency_key = ${params.idempotencyKey}
        LIMIT 1
      `)) as unknown as GenerationRow[];
      return { kind: "pending", requestId: winner?.id ?? "" };
    }
  }

  const sameRequest =
    row.feature === params.feature &&
    (params.lectureId ?? null) === row.lecture_id &&
    (params.practicalTrackId ?? null) === row.practical_track_id;
  if (!sameRequest) return { kind: "conflict" };

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
  if (row.status === "pending") return { kind: "pending", requestId: row.id ?? "" };
  return { kind: "failed", requestId: row.id ?? "" };
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