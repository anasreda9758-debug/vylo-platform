import { z } from "zod";

// ── Chat API ──
export const tutorChatSchema = z.object({
  lectureId: z.string().min(1).max(200),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
});

// ── Quiz Answer ──
export const quizAnswerSchema = z.object({
  bankSlug: z.string().min(1).max(200),
  questionId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(200),
  timeSpentMs: z.number().int().min(0).max(300000).optional(),
  attemptId: z.string().min(1).max(200).optional(),
});

// ── Quiz Finish ──
export const quizFinishSchema = z.object({
  attemptId: z.string().min(1).max(200),
});

// ── Quiz Questions ──
export const quizQuestionsSchema = z.object({
  slug: z.string().min(1).max(200).optional(),
  count: z.coerce.number().int().min(1).max(50).default(5),
});

// ── Battle Create ──
export const battleCreateSchema = z.object({
  bankSlug: z.string().min(1).max(200),
  questionCount: z.number().int().min(1).max(20).default(5),
});

// ── Battle Answer ──
export const battleAnswerSchema = z.object({
  battleId: z.string().uuid(),
  questionId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(200),
});

// ── Battle Ready ──
export const battleReadySchema = z.object({
  battleId: z.string().uuid(),
});

// ── Battle Finish ──
export const battleFinishSchema = z.object({
  battleId: z.string().uuid(),
});

// ── Flashcard Review ──
export const flashcardReviewSchema = z.object({
  flashcardId: z.string().min(1).max(200),
  quality: z.number().int().min(0).max(5),
});

// ── Question Review Answer (initial review / SM-2) ──
export const questionReviewAnswerSchema = z.object({
  questionId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(200),
  timeSpentMs: z.number().int().min(0).max(300000).optional(),
});

// ── Case Evaluate ──
export const caseEvaluateSchema = z.object({
  caseId: z.string().min(1).max(200),
  answer: z.string().min(1).max(4000),
});

// ── Billing Purchase ──
export const purchaseSchema = z.object({
  planId: z.string().min(1).max(200),
});

// ── Subscription Toggle (Admin) ──
export const subscriptionToggleSchema = z.object({
  userId: z.string().min(1).max(200),
  active: z.boolean(),
});
