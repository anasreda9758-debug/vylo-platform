import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { lecture } from "../curriculum/schema";

export const flashcard = pgTable(
  "flashcard",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lectureId: text("lecture_id")
      .notNull()
      .references(() => lecture.id, { onDelete: "cascade" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    intervalDays: integer("interval_days").notNull().default(1),
    dueDate: timestamp("due_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("flashcard_user_due_idx").on(table.userId, table.dueDate)],
);

export const clinicalCase = pgTable(
  "clinical_case",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lectureId: text("lecture_id")
      .notNull()
      .references(() => lecture.id, { onDelete: "cascade" }),
    caseText: text("case_text").notNull(),
    questionsJson: text("questions_json").notNull(),
    modelAnswersJson: text("model_answers_json").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("clinical_case_user_idx").on(table.userId)],
);

export const flashcardRelations = relations(flashcard, ({ one }) => ({
  user: one(user, {
    fields: [flashcard.userId],
    references: [user.id],
  }),
  lecture: one(lecture, {
    fields: [flashcard.lectureId],
    references: [lecture.id],
  }),
}));

export const clinicalCaseEvaluation = pgTable(
  "clinical_case_evaluation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: text("case_id")
      .notNull()
      .references(() => clinicalCase.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    answersJson: jsonb("answers_json").notNull(),
    score: integer("score").notNull(),
    feedbackJson: jsonb("feedback_json"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("clinical_case_evaluation_case_user_attempt_unique").on(
      table.caseId,
      table.userId,
      table.attemptNumber,
    ),
    index("clinical_case_evaluation_case_user_idx").on(table.caseId, table.userId),
  ],
);

export const clinicalCaseRelations = relations(clinicalCase, ({ one }) => ({
  user: one(user, {
    fields: [clinicalCase.userId],
    references: [user.id],
  }),
  lecture: one(lecture, {
    fields: [clinicalCase.lectureId],
    references: [lecture.id],
  }),
  evaluations: one(clinicalCaseEvaluation, {
    fields: [clinicalCase.id],
    references: [clinicalCaseEvaluation.caseId],
  }),
}));
