import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { gradeAnswer, resolveAttempt } from "@/features/practice/queries";
import { awardXp, hasEarnedQuizCorrectToday } from "@/features/gamification/queries";
import { quizAnswerSchema } from "@/shared/validation";
import {
  getAccessibleQuestion,
  getAccessibleQuestionBankBySlug,
  getAccessibleQuizAttempt,
  questionBelongsToBank,
} from "@/features/access/learning-access";
import { safeAwardXpGeneral } from "@/features/gamification/error-handling";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let bankSlug: string;
  let questionId: string;
  let optionId: string;
  let timeSpentMs: number | undefined;
  let attemptId: string | undefined;
  try {
    const body = await request.json();
    const parsed = quizAnswerSchema.parse(body);
    bankSlug = parsed.bankSlug;
    questionId = parsed.questionId;
    optionId = parsed.optionId;
    timeSpentMs = parsed.timeSpentMs;
    attemptId = parsed.attemptId;
  } catch (e: any) {
    if (e?.issues) {
      return NextResponse.json({ error: "validation", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const bankAccess = await getAccessibleQuestionBankBySlug(session.user, bankSlug);
  if (!bankAccess.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bank = bankAccess.value;

  const questionAccess = await getAccessibleQuestion(session.user, questionId);
  if (!questionAccess.ok || !questionBelongsToBank(questionAccess.value.bankId, bank.id)) {
    return NextResponse.json({ error: "question not found" }, { status: 404 });
  }

  let attempt;
  if (attemptId) {
    const attemptAccess = await getAccessibleQuizAttempt(session.user, attemptId);
    if (!attemptAccess.ok) return NextResponse.json({ error: "attempt not found" }, { status: 404 });
    if (attemptAccess.value.status !== "in_progress" || attemptAccess.value.bankId !== bank.id) {
      return NextResponse.json({ error: "attempt does not match quiz" }, { status: 400 });
    }
    attempt = attemptAccess.value;
  } else {
    attempt = await resolveAttempt(session.user.id, bank.id);
  }

  const result = await gradeAnswer({
    attemptId: attempt.id,
    questionId,
    optionId,
    timeSpentMs,
  });
  if (!result) {
    return NextResponse.json({ error: "question or option not found" }, { status: 400 });
  }

  // Award XP for correct answer, once per question per day (anti-farming).
  if (result.correct && !(await hasEarnedQuizCorrectToday(session.user.id, questionId))) {
    await safeAwardXpGeneral(
      () => awardXp(session.user.id, "quiz_correct", questionId),
      (msg, err) => console.warn(`[quiz_correct] ${msg}`, err),
    );
  }

  return NextResponse.json({ attemptId: attempt.id, ...result });
}
