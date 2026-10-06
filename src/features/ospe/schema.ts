import { index, integer, json, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "../auth/schema";
import { practicalTrack } from "../practical/schema";

/**
 * OSPE Answer Key — the correct answer for each station image.
 * Linked by folder + fileName (matches the image on disk).
 */
export const ospeAnswerKey = pgTable(
  "ospe_answer_key",
  {
    id: text("id").primaryKey(),
    folder: text("folder").notNull(),
    fileName: text("file_name").notNull(),
    diagnosis: text("diagnosis").notNull(),
    // Optional structured breakdown
    identification: text("identification"), // what the student should identify
    findings: text("findings"),             // key clinical findings
    differential: text("differential"),     // differential diagnoses
    management: text("management"),         // management plan
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ospe_answer_key_folder_idx").on(table.folder),
    index("ospe_answer_key_lookup_idx").on(table.folder, table.fileName),
  ],
);

/**
 * OSPE Rubric — scoring criteria for a station.
 * Each rubric item is a criterion worth a certain number of points.
 */
export const ospeRubric = pgTable(
  "ospe_rubric",
  {
    id: text("id").primaryKey(),
    answerKeyId: text("answer_key_id")
      .notNull()
      .references(() => ospeAnswerKey.id, { onDelete: "cascade" }),
    criterion: text("criterion").notNull(),  // e.g. "Correct identification", "Key finding 1"
    maxPoints: integer("max_points").notNull().default(1),
    order: integer("order").notNull().default(0),
  },
  (table) => [
    index("ospe_rubric_key_idx").on(table.answerKeyId),
  ],
);

/** Explicit reviewed relationship; folder/file names never infer a subject. */
export const practicalTrackOspeStation = pgTable(
  "practical_track_ospe_station",
  {
    trackId: text("track_id").notNull().references(() => practicalTrack.id, { onDelete: "cascade" }),
    answerKeyId: text("answer_key_id").notNull().references(() => ospeAnswerKey.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.answerKeyId] }),
    index("practical_track_ospe_answer_key_idx").on(table.answerKeyId),
  ],
);

/**
 * OSPE Exam — a timed, locked exam session.
 * When examMode=true, the student sees one station at a time with a strict timer,
 * no ability to go back, and auto-submit when time runs out.
 */
export const ospeExam = pgTable(
  "ospe_exam",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    practicalTrackId: text("practical_track_id").references(() => practicalTrack.id),
    folder: text("folder"), // null = mixed across all folders
    stationCount: integer("station_count").notNull().default(10),
    timePerStationSec: integer("time_per_station_sec").notNull().default(60),
    totalTimeLimitSec: integer("total_time_limit_sec").notNull().default(600),
    status: text("status").notNull().default("pending"), // pending | in_progress | completed | timed_out
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    totalScore: integer("total_score"),
    maxPossibleScore: integer("max_possible_score"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ospe_exam_user_idx").on(table.userId),
    index("ospe_exam_status_idx").on(table.status),
  ],
);

/**
 * OSPE Exam Station — a single station within an exam.
 */
export const ospeExamStation = pgTable(
  "ospe_exam_station",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => ospeExam.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    folder: text("folder").notNull(),
    fileName: text("file_name").notNull(),
    answerKeyId: text("answer_key_id").references(() => ospeAnswerKey.id),
    // Student's answer
    studentAnswer: text("student_answer"),
    score: integer("score"),
    timeSpentSec: integer("time_spent_sec"),
    answeredAt: timestamp("answered_at"),
  },
  (table) => [
    index("ospe_exam_station_exam_idx").on(table.examId),
  ],
);

// Relations
export const ospeAnswerKeyRelations = relations(ospeAnswerKey, ({ many }) => ({
  rubrics: many(ospeRubric),
}));

export const ospeRubricRelations = relations(ospeRubric, ({ one }) => ({
  answerKey: one(ospeAnswerKey, {
    fields: [ospeRubric.answerKeyId],
    references: [ospeAnswerKey.id],
  }),
}));

export const ospeExamRelations = relations(ospeExam, ({ one, many }) => ({
  user: one(user, {
    fields: [ospeExam.userId],
    references: [user.id],
  }),
  stations: many(ospeExamStation),
}));

export const ospeExamStationRelations = relations(ospeExamStation, ({ one }) => ({
  exam: one(ospeExam, {
    fields: [ospeExamStation.examId],
    references: [ospeExam.id],
  }),
  answerKey: one(ospeAnswerKey, {
    fields: [ospeExamStation.answerKeyId],
    references: [ospeAnswerKey.id],
  }),
}));
