import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { academicPeriod, subject } from "../hierarchy/schema";

export const curriculumModule = pgTable("module", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  subjectId: text("subject_id").references(() => subject.id, { onDelete: "set null" }),
  order: integer("order").notNull().default(0),
  isFree: boolean("is_free").notNull().default(false),
  studyYear: integer("study_year").notNull().default(1),
  term: integer("term").notNull().default(1),
  academicPeriodId: text("academic_period_id").references(() => academicPeriod.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [index("module_study_year_idx").on(table.studyYear)]);

export const lecture = pgTable(
  "lecture",
  {
    id: text("id").primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => curriculumModule.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    subject: text("subject"),
    kind: text("kind"),
    content: text("content"),
    pdfFile: text("pdf_file"),
    pdfPageStart: integer("pdf_page_start"),
    pdfPageEnd: integer("pdf_page_end"),
    summaryJson: jsonb("summary_json").$type<{
      overview: string;
      keyPoints: string[];
      clinicalPearls: string[];
      references: string[];
    }>(),
    mindmapJson: jsonb("mindmap_json").$type<{
      label: string;
      children: { label: string; children?: { label: string }[] }[];
    }>(),
    order: integer("order").notNull().default(0),
    durationMin: integer("duration_min"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("lecture_module_id_idx").on(table.moduleId),
    uniqueIndex("lecture_slug_idx").on(table.slug),
  ],
);

export const lectureProgress = pgTable(
  "lecture_progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lectureId: text("lecture_id")
      .notNull()
      .references(() => lecture.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("lecture_progress_user_lecture_idx").on(table.userId, table.lectureId),
    uniqueIndex("lecture_progress_user_lecture_unique").on(table.userId, table.lectureId),
  ],
);

export const lectureNote = pgTable(
  "lecture_note",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lectureId: text("lecture_id")
      .notNull()
      .references(() => lecture.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    highlightedText: text("highlighted_text"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("lecture_note_user_lecture_idx").on(table.userId, table.lectureId)],
);

export const curriculumModuleRelations = relations(curriculumModule, ({ one, many }) => ({
  lectures: many(lecture),
  academicPeriod: one(academicPeriod, {
    fields: [curriculumModule.academicPeriodId],
    references: [academicPeriod.id],
  }),
}));

export const lectureRelations = relations(lecture, ({ one, many }) => ({
  module: one(curriculumModule, {
    fields: [lecture.moduleId],
    references: [curriculumModule.id],
  }),
  progress: many(lectureProgress),
  notes: many(lectureNote),
}));

export const lectureProgressRelations = relations(lectureProgress, ({ one }) => ({
  lecture: one(lecture, {
    fields: [lectureProgress.lectureId],
    references: [lecture.id],
  }),
  user: one(user, {
    fields: [lectureProgress.userId],
    references: [user.id],
  }),
}));

export const lectureNoteRelations = relations(lectureNote, ({ one }) => ({
  lecture: one(lecture, {
    fields: [lectureNote.lectureId],
    references: [lecture.id],
  }),
  user: one(user, {
    fields: [lectureNote.userId],
    references: [user.id],
  }),
}));
