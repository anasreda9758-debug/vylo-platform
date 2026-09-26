import { pgTable, text, timestamp, integer, uuid, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { user } from "@/features/auth/schema";
import { lecture } from "@/features/curriculum/schema";
import { practicalTrack } from "@/features/practical/schema";

export const userProfile = pgTable(
  "user_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    totalXp: integer("total_xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    streak: integer("streak").notNull().default(0),
    lastActiveDate: timestamp("last_active_date"),
    battlesWon: integer("battles_won").notNull().default(0),
    battlesLost: integer("battles_lost").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("user_profile_user_id_idx").on(t.userId)],
);

export const xpLog = pgTable(
  "xp_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    referenceId: text("reference_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("xp_log_user_id_idx").on(t.userId)],
);

export const battle = pgTable(
  "battle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("waiting"),
    bankSlug: text("bank_slug").notNull(),
    questionCount: integer("question_count").notNull().default(5),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    winnerId: text("winner_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("battle_status_idx").on(t.status)],
);

export const battleParticipant = pgTable(
  "battle_participant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    battleId: uuid("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    total: integer("total").notNull().default(0),
    isReady: integer("is_ready").notNull().default(0),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    index("battle_participant_battle_idx").on(t.battleId),
    index("battle_participant_user_idx").on(t.userId),
  ],
);

export const battleAnswer = pgTable(
  "battle_answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    battleId: uuid("battle_id")
      .notNull()
      .references(() => battle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    optionId: text("option_id").notNull(),
    isCorrect: integer("is_correct").notNull().default(0),
    answeredAt: timestamp("answered_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("battle_answer_unique").on(t.battleId, t.userId, t.questionId),
  ],
);

export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    usageDate: text("usage_date").notNull(),
    bucket: text("bucket").notNull().default("study_generation"),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.usageDate, t.bucket] }),
    index("ai_usage_daily_user_date_idx").on(t.userId, t.usageDate),
  ],
);

export const aiGenerationRequest = pgTable(
  "ai_generation_request",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    lectureId: text("lecture_id").references(() => lecture.id),
    practicalTrackId: text("practical_track_id").references(() => practicalTrack.id),
    status: text("status").notNull().default("pending"),
    resultJson: text("result_json"),
    quotaReserved: integer("quota_reserved").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("ai_generation_request_user_feature_idx").on(t.userId, t.lectureId, t.practicalTrackId),
    uniqueIndex("ai_generation_request_user_idempotency_key_unique").on(t.userId, t.idempotencyKey),
  ],
);