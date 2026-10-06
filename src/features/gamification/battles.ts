import { db } from "@/shared/db";
import { sql } from "drizzle-orm";
import { battle, battleParticipant, battleAnswer } from "./schema";
import { getAccessibleQuestionBankBySlug } from "@/features/access/learning-access";
import { getPersistedContentActor } from "@/features/access/persisted-content";

export async function createBattle(createdBy: string, bankSlug: string, questionCount = 5) {
  const [b] = await db.execute(sql`
    INSERT INTO battle (bank_slug, question_count, created_by, status)
    VALUES (${bankSlug}, ${questionCount}, ${createdBy}, 'waiting')
    RETURNING id
  `);

  const battleId = (b as any).id;

  // Creator auto-joins
  await db.execute(sql`
    INSERT INTO battle_participant (battle_id, user_id, is_ready)
    VALUES (${battleId}, ${createdBy}, 0)
  `);

  return battleId;
}

export async function joinBattle(battleId: string, userId: string) {
  // Check if battle exists and is waiting
  const [b] = await db.execute(sql`
    SELECT id, status, created_by FROM battle WHERE id = ${battleId}
  `);
  if (!b || (b as any).status !== "waiting") return null;

  // Check if already joined
  const [existing] = await db.execute(sql`
    SELECT 1 FROM battle_participant WHERE battle_id = ${battleId} AND user_id = ${userId}
  `);
  if (existing) return battleId;

  // Check if full (max 2)
  const [count] = await db.execute(sql`
    SELECT count(*) as cnt FROM battle_participant WHERE battle_id = ${battleId}
  `);
  if (Number((count as any).cnt) >= 2) return null;

  await db.execute(sql`
    INSERT INTO battle_participant (battle_id, user_id, is_ready)
    VALUES (${battleId}, ${userId}, 0)
  `);

  return battleId;
}

export async function setReady(battleId: string, userId: string) {
  await db.execute(sql`
    UPDATE battle_participant SET is_ready = 1
    WHERE battle_id = ${battleId} AND user_id = ${userId}
  `);

  // Check if all ready (need 2)
  const [count] = await db.execute(sql`
    SELECT count(*) as cnt FROM battle_participant
    WHERE battle_id = ${battleId} AND is_ready = 1
  `);

  if (Number((count as any).cnt) >= 2) {
    // Start the battle
    await db.execute(sql`
      UPDATE battle SET status = 'active', started_at = CURRENT_TIMESTAMP
      WHERE id = ${battleId}
    `);
    return true; // battle started
  }
  return false; // waiting for other player
}

export async function answerBattleQuestion(
  battleId: string,
  userId: string,
  questionId: string,
  optionId: string,
  isCorrect: boolean,
) {
  await db.execute(sql`
    INSERT INTO battle_answer (battle_id, user_id, question_id, option_id, is_correct)
    VALUES (${battleId}, ${userId}, ${questionId}, ${optionId}, ${isCorrect ? 1 : 0})
    ON CONFLICT (battle_id, user_id, question_id) DO UPDATE SET
      option_id = ${optionId},
      is_correct = ${isCorrect ? 1 : 0},
      answered_at = CURRENT_TIMESTAMP
  `);
}

export async function finishBattle(battleId: string) {
  // Get scores
  const scores = await db.execute(sql`
    SELECT user_id, sum(is_correct) as score, count(*) as total
    FROM battle_answer
    WHERE battle_id = ${battleId}
    GROUP BY user_id
  `);

  const scoreMap = new Map<string, { score: number; total: number }>();
  for (const s of scores as any[]) {
    scoreMap.set(s.user_id, { score: Number(s.score), total: Number(s.total) });
  }

  // Update participant scores
  for (const [userId, { score, total }] of scoreMap) {
    await db.execute(sql`
      UPDATE battle_participant SET score = ${score}, total = ${total}
      WHERE battle_id = ${battleId} AND user_id = ${userId}
    `);
  }

  // Determine winner
  let winnerId: string | null = null;
  let bestScore = -1;
  for (const [userId, { score }] of scoreMap) {
    if (score > bestScore) {
      bestScore = score;
      winnerId = userId;
    }
  }

  // If tie, no winner
  if (winnerId) {
    const allScored = Array.from(scoreMap.values());
    if (allScored.length === 2 && allScored[0].score === allScored[1].score) {
      winnerId = null; // tie
    }
  }

  await db.execute(sql`
    UPDATE battle SET
      status = 'finished',
      finished_at = CURRENT_TIMESTAMP,
      winner_id = ${winnerId}
    WHERE id = ${battleId}
  `);

  // Update win/loss counts
  if (winnerId) {
    await db.execute(sql`
      UPDATE user_profile SET battles_won = battles_won + 1 WHERE user_id = ${winnerId}
    `);
    const losers = await db.execute(sql`
      SELECT user_id FROM battle_participant WHERE battle_id = ${battleId} AND user_id != ${winnerId}
    `);
    for (const l of losers as any[]) {
      await db.execute(sql`
        UPDATE user_profile SET battles_lost = battles_lost + 1 WHERE user_id = ${l.user_id}
      `);
    }
  }

  return {
    winnerId,
    scores: Object.fromEntries(scoreMap),
  };
}

export async function getBattle(battleId: string) {
  const [b] = await db.execute(sql`SELECT * FROM battle WHERE id = ${battleId}`);
  if (!b) return null;

  const participants = await db.execute(sql`
    SELECT bp.*, u.name as "userName"
    FROM battle_participant bp
    JOIN "user" u ON u.id = bp.user_id
    WHERE bp.battle_id = ${battleId}
  `);

  return {
    ...(b as any),
    participants: (participants as any[]).map((p) => ({
      userId: p.user_id,
      userName: p.userName,
      score: p.score,
      total: p.total,
      isReady: p.is_ready === 1,
    })),
  };
}

export async function getUserBattles(userId: string, limit = 10) {
  const actor = await getPersistedContentActor(userId);
  if (!actor) return [];
  const rows = await db.execute(sql`
    SELECT b.*, bp.score as my_score, bp.total as my_total,
      (SELECT bp2.score FROM battle_participant bp2 WHERE bp2.battle_id = b.id AND bp2.user_id != ${userId} LIMIT 1) as opponent_score,
      (SELECT u.name FROM battle_participant bp2 JOIN "user" u ON u.id = bp2.user_id WHERE bp2.battle_id = b.id AND bp2.user_id != ${userId} LIMIT 1) as opponent_name
    FROM battle b
    JOIN battle_participant bp ON bp.battle_id = b.id AND bp.user_id = ${userId}
    WHERE b.status = 'finished'
    ORDER BY b.finished_at DESC
    LIMIT ${limit}
  `);

  const accessible: (typeof rows)[number][] = [];
  for (const row of rows) {
    const access = await getAccessibleQuestionBankBySlug(actor, String(row.bank_slug));
    if (access.ok) accessible.push(row);
  }
  return (accessible as any[]).map((r) => ({
    id: r.id,
    bankSlug: r.bank_slug,
    myScore: r.my_score,
    myTotal: r.my_total,
    opponentScore: r.opponent_score,
    opponentName: r.opponent_name,
    won: r.winner_id === userId,
    tied: r.winner_id === null,
    finishedAt: r.finished_at,
  }));
}
