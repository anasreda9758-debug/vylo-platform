import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "@/features/auth/schema";
import { curriculumModule, lecture } from "@/features/curriculum/schema";
import { academicYear } from "@/features/hierarchy/schema";
import { aiGenerationRequest } from "@/features/gamification/schema";
import type { Marker, SourceMaterial, PracticalQuestion, PracticalSubject, PracticalTrackStatus } from "./model";

export const practicalTrack = pgTable("practical_track", {
  id: text("id").primaryKey(),
  moduleId: text("module_id").notNull().references(() => curriculumModule.id),
  subject: text("subject").$type<PracticalSubject>().notNull(),
  subjectSlug: text("subject_slug").notNull(),
  displayNameEn: text("display_name_en").notNull(),
  displayNameAr: text("display_name_ar"),
  status: text("status").$type<PracticalTrackStatus>().notNull().default("DRAFT"),
  sortOrder: integer("sort_order").notNull().default(0),
  practiceEnabled: boolean("practice_enabled").notNull().default(true),
  ospeEnabled: boolean("ospe_enabled").notNull().default(false),
}, (t) => [
  uniqueIndex("practical_track_module_subject_slug").on(t.moduleId, t.subjectSlug),
  index("practical_track_module_status_order").on(t.moduleId, t.status, t.sortOrder),
]);

export const practicalImage = pgTable("practical_image", {
  id: text("id").primaryKey(),
  trackId: text("practical_track_id").references((): any => practicalTrack.id),
  moduleId: text("module_id").notNull().references(() => curriculumModule.id),
  studyYear: integer("study_year").notNull(),
  subject: text("subject").notNull(),
  storageKey: text("storage_key").notNull(),
  alt: text("alt").notNull(),
  sourceMaterial: jsonb("source_material").$type<SourceMaterial>().notNull(),
  sourcePage: integer("source_page").notNull(),
  markers: jsonb("markers").$type<Marker[]>().notNull().default([]),
  status: text("status").$type<PracticalQuestion["status"]>().notNull().default("DRAFT_AI"),
  isFixture: boolean("is_fixture").notNull().default(false),
  sourceImageId: text("source_image_id").references((): any => practicalImage.id),
  examImageId: text("exam_image_id").references((): any => practicalImage.id),
  targetX: integer("target_x"),
  targetY: integer("target_y"),
  isExamDerivative: boolean("is_exam_derivative").notNull().default(false),
  generationStatus: text("generation_status").notNull().default("DRAFT"),
  reviewStatus: text("review_status").notNull().default("DRAFT"),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
});

export const practicalQuestion = pgTable("practical_question", {
  id: text("id").primaryKey(),
  trackId: text("practical_track_id").references(() => practicalTrack.id),
  academicYearId: text("academic_year_id").references(() => academicYear.id),
  studyYear: integer("study_year").notNull(),
  moduleId: text("module_id").notNull().references(() => curriculumModule.id),
  subject: text("subject").notNull(),
  sourceLectureId: text("source_lecture_id").references(() => lecture.id),
  sourceMaterial: jsonb("source_material").$type<SourceMaterial>().notNull(),
  sourcePage: integer("source_page").notNull(),
  questionType: text("question_type").$type<PracticalQuestion["questionType"]>().notNull(),
  answerFormat: text("answer_format").$type<"SINGLE_CHOICE">().notNull().default("SINGLE_CHOICE"),
  imageId: text("image_id").notNull().references(() => practicalImage.id),
  markerIds: jsonb("marker_ids").$type<string[]>().notNull().default([]),
  groupId: text("group_id").notNull(),
  order: integer("order").notNull(),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<PracticalQuestion["options"]>().notNull(),
  correctOptionId: text("correct_option_id").notNull(),
  explanation: text("explanation").notNull(),
  identifyingClue: text("identifying_clue").notNull(),
  commonMistake: text("common_mistake").notNull(),
  examTip: text("exam_tip").notNull(),
  status: text("status").$type<PracticalQuestion["status"]>().notNull().default("DRAFT_AI"),
  isFixture: boolean("is_fixture").notNull().default(false),
  sourceImageId: text("source_image_id").references(() => practicalImage.id),
  examImageId: text("exam_image_id").references(() => practicalImage.id),
  targetX: integer("target_x"),
  targetY: integer("target_y"),
  generationRequestId: text("generation_request_id").references(() => aiGenerationRequest.idempotencyKey),
  generationStatus: text("generation_status").notNull().default("DRAFT"),
  reviewStatus: text("review_status").notNull().default("DRAFT"),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
}, (t) => [
  check("practical_single_choice", sql`${t.answerFormat} = 'SINGLE_CHOICE'`),
  check("practical_correct_option", sql`${t.options} @> jsonb_build_array(jsonb_build_object('id', ${t.correctOptionId}))`),
]);

export const practicalProgress = pgTable("practical_progress", {
  userId: text("user_id").notNull().references(() => user.id),
  questionId: text("question_id").notNull().references(() => practicalQuestion.id),
  attempts: integer("attempts").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  wrong: integer("wrong").notNull().default(0),
  wrongRemaining: boolean("wrong_remaining").notNull().default(false),
  bookmarked: boolean("bookmarked").notNull().default(false),
  difficult: boolean("difficult").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.questionId] })]);

export const practicalSubmission = pgTable("practical_submission", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  requestId: text("request_id").notNull(),
  questionId: text("question_id").notNull().references(() => practicalQuestion.id),
  optionId: text("option_id").notNull(),
  correct: boolean("correct").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("practical_submission_user_request").on(t.userId, t.requestId)]);