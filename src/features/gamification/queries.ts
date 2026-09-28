import { db, client } from "@/shared/db";
import { sql, eq, desc, and } from "drizzle-orm";
import { userProfile, xpLog } from "./schema";
import type { PgClient } from "@/shared/db";

const XP_REWARDS = {
  lecture_complete: 10,
  quiz_correct: 5,
  quiz_complete_bonus: 20,
  flashcard_review: 2,
  case_complete: 15,
  daily_streak: 5,
  battle_win: 30,
  battle_lose: 10,
} as const;

export type XpReason = keyof typeof XP_REWARDS;

function calcLevel(totalXp: number): number {
  return Math.floor(totalXp / 200) + 1;
}

function xpForNextLevel(level: number): number {
  return level * 200;
}

/** Returns today's date as YYYY-MM-DD string (Egypt timezone). */
function todayStr(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Africa/Cairo" });
}

/** Returns yesterday's date as YYYY-MM-DD string. */
function yesterdayStr(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE", { timeZone: "Africa/Cairo" });
}

/**
 * Update streak: if lastActiveDate is today, no-op.
 * If it's yesterday, increment streak.
 * If older, reset to 1.
 * Awards daily_streak XP on streak milestone days (7, 14, 21, 30, 60, 90, 180, 365).
 */
export async function updateStreak(userId: string): Promise<{ streak: number; bonusAwarded: boolean }> {
  const [row] = await db.execute(sql`
    SELECT streak, last_active_date FROM user_profile WHERE user_id = ${userId}
  `);

  const today = todayStr();
  const yesterday = yesterdayStr();
  const lastActive = (row as any)?.last_active_date
    ? new Date((row as any).last_active_date as string)
    : null;
  const lastActiveDay = lastActive
    ? lastActive.toLocaleDateString("sv-SE", { timeZone: "Africa/Cairo" })
    : null;

  // Already active today — no change
  if (lastActiveDay === today) {
    return { streak: (row as any)?.streak ?? 1, bonusAwarded: false };
  }

  const currentStreak = (row as any)?.streak ?? 0;
  let newStreak: number;
  let bonusAwarded = false;

  if (lastActiveDay === yesterday) {
    // Consecutive day — increment
    newStreak = currentStreak + 1;
  } else {
    // Streak broken or first day — reset to 1
    newStreak = 1;
  }

  // Award bonus XP on milestone streak days
  const MILESTONES = [7, 14, 21, 30, 60, 90, 180, 365];
  if (MILESTONES.includes(newStreak)) {
    await awardXp(userId, "daily_streak", `streak-${newStreak}`);
    bonusAwarded = true;
  }

  // Update profile
  await db.execute(sql`
    INSERT INTO user_profile (user_id, total_xp, level, streak, last_active_date, updated_at)
    VALUES (${userId}, 0, 1, ${newStreak}, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      streak = ${newStreak},
      last_active_date = NOW(),
      updated_at = NOW()
  `);

  return { streak: newStreak, bonusAwarded };
}

export async function awardXp(userId: string, reason: XpReason, referenceId?: string): Promise<{
  amount: number;
  reason: XpReason;
  totalXp: number;
  level: number;
  xpToNext: number;
  alreadyAwarded?: boolean;
}> {
  const amount = XP_REWARDS[reason];

  // Use a database transaction for atomic XP accounting
  // For lecture_complete, the unique constraint on xp_log will cause the transaction
  // to rollback on duplicate, preventing partial state
  return await client.begin(async (tx: any) => {
    // Attempt to insert xp_log first - this will fail on duplicate lecture_complete
    // due to the unique partial index, causing the transaction to rollback
    await tx.unsafe(sql`
      INSERT INTO xp_log (user_id, amount, reason, reference_id)
      VALUES (${userId}, ${amount}, ${reason}, ${referenceId ?? null})
    `);

    // If we get here, xp_log insert succeeded. Now update user_profile atomically.
    const [existing] = await tx.unsafe(sql`
      SELECT total_xp FROM user_profile WHERE user_id = ${userId}
    `);
    const currentXp = (existing as any)?.total_xp ?? 0;
    const newXp = currentXp + amount;
    const newLevel = calcLevel(newXp);

    await tx.unsafe(sql`
      INSERT INTO user_profile (user_id, total_xp, level, streak, last_active_date, updated_at)
      VALUES (${userId}, ${newXp}, ${newLevel}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        total_xp = ${newXp},
        level = ${newLevel},
        updated_at = CURRENT_TIMESTAMP
    `);

    // Return updated profile
    const [profile] = await tx.unsafe(sql`
      SELECT total_xp, level, streak FROM user_profile WHERE user_id = ${userId}
    `);

    return {
      amount,
      reason,
      totalXp: (profile as any)?.total_xp ?? amount,
      level: (profile as any)?.level ?? calcLevel(amount),
      xpToNext: xpForNextLevel((profile as any)?.level ?? calcLevel(amount)) - ((profile as any)?.total_xp ?? amount),
    };
  }).catch((error: any) => {
    // Handle expected duplicate lecture/case completion - check if it's the unique constraint violation
    const err = error as { code?: string; constraint?: string };
    if (err?.code === '23505' && (err?.constraint === 'xp_log_user_lecture_complete_unique' || err?.constraint === 'xp_log_user_case_complete_unique')) {
      // Expected idempotent duplicate - return current state without modifying anything
      return getCurrentXpState(userId, amount, reason, true);
    }
    // Re-throw unexpected errors
    throw error;
  });
}

async function getCurrentXpState(userId: string, amount: number, reason: XpReason, alreadyAwarded = false) {
  const [profile] = await db.execute(sql`
    SELECT total_xp, level, streak FROM user_profile WHERE user_id = ${userId}
  `);
  const currentXp = (profile as any)?.total_xp ?? 0;
  const currentLevel = (profile as any)?.level ?? 1;
  return {
    amount,
    reason,
    totalXp: currentXp,
    level: currentLevel,
    xpToNext: xpForNextLevel(currentLevel) - currentXp,
    alreadyAwarded,
  };
}

export async function getProfile(userId: string) {
  const [profile] = await db.execute(sql`
    SELECT * FROM user_profile WHERE user_id = ${userId}
  `);

  if (!profile) {
    // Create default profile
    await db.execute(sql`
      INSERT INTO user_profile (user_id, total_xp, level, streak, last_active_date)
      VALUES (${userId}, 0, 1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO NOTHING
    `);
    return {
      totalXp: 0,
      level: 1,
      streak: 1,
      battlesWon: 0,
      battlesLost: 0,
      xpToNext: 200,
    };
  }

  const p = profile as any;
  return {
    totalXp: p.total_xp,
    level: p.level,
    streak: p.streak,
    battlesWon: p.battles_won,
    battlesLost: p.battles_lost,
    xpToNext: xpForNextLevel(p.level) - p.total_xp,
  };
}

export async function getLeaderboard(limit = 20) {
  const rows = await db.execute(sql`
    SELECT
      up.user_id as "userId",
      u.name as "userName",
      up.total_xp as "totalXp",
      up.level,
      up.battles_won as "battlesWon",
      up.battles_lost as "battlesLost"
    FROM user_profile up
    JOIN "user" u ON u.id = up.user_id
    ORDER BY up.total_xp DESC
    LIMIT ${limit}
  `);

  return (rows as any[]).map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    userName: r.userName,
    totalXp: r.totalXp,
    level: r.level,
    battlesWon: r.battlesWon,
    battlesLost: r.battlesLost,
  }));
}

export async function getXpHistory(userId: string, limit = 20) {
  const rows = await db.execute(sql`
    SELECT amount, reason, reference_id, created_at
    FROM xp_log
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return (rows as any[]).map((r) => ({
    amount: r.amount,
    reason: r.reason,
    referenceId: r.reference_id,
    createdAt: r.created_at,
  }));
}

/**
 * Check if user has already earned XP for completing a specific lecture.
 * Uses xp_log as the durable record (survives lecture_progress deletion on unmark).
 */
export async function hasEarnedLectureCompletionXp(userId: string, lectureId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM xp_log
    WHERE user_id = ${userId}
      AND reason = 'lecture_complete'
      AND reference_id = ${lectureId}
    LIMIT 1
  `);
  return (rows as any[]).length > 0;
}

/**
 * Check if user has already earned XP for completing a specific clinical case.
 * Uses xp_log as the durable record (unique partial index on case_complete).
 */
export async function hasEarnedCaseCompletionXp(userId: string, caseId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM xp_log
    WHERE user_id = ${userId}
      AND reason = 'case_complete'
      AND reference_id = ${caseId}
    LIMIT 1
  `);
  return (rows as any[]).length > 0;
}

/**
 * True when the user already earned quiz_correct XP for this question today.
 * Prevents re-answering a known-correct question to farm XP while still
 * rewarding each newly-learned correct answer once per day.
 */
export async function hasEarnedQuizCorrectToday(userId: string, questionId: string, now = new Date()): Promise<boolean> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db.execute(sql`
    SELECT 1 FROM xp_log
    WHERE user_id = ${userId}
      AND reason = 'quiz_correct'
      AND reference_id = ${questionId}
      AND created_at >= ${startOfDay}
    LIMIT 1
  `);
  return (rows as any[]).length > 0;
}
