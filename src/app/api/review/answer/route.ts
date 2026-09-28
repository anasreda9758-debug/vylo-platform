import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { updateQuestionReview } from "@/features/practice/queries";
import { getAccessibleQuestionReview } from "@/features/access/learning-access";
import { questionReviewAnswerSchema } from "@/shared/validation";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let questionId: string;
  let optionId: string;
  let timeSpentMs: number | undefined;
  try {
    const parsed = questionReviewAnswerSchema.parse(await request.json());
    questionId = parsed.questionId;
    optionId = parsed.optionId;
    timeSpentMs = parsed.timeSpentMs;
  } catch (e: any) {
    if (e?.issues || e instanceof SyntaxError) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // A review answer is only valid for this user's scheduled review item.
  const reviewAccess = await getAccessibleQuestionReview(session.user, questionId);
  if (!reviewAccess.ok) return NextResponse.json({ error: "question not found" }, { status: 404 });
  const q = reviewAccess.value.question;

  const selected = q.options.find((o) => o.id === optionId);
  if (!selected) return NextResponse.json({ error: "option not found" }, { status: 404 });

  const isCorrect = selected.isCorrect;
  const correctOption = q.options.find((o) => o.isCorrect);

  // Lightweight approach: directly update SM-2 without creating attempt pollution
  // Use timeSpentMs to calculate quality
  await updateQuestionReview(session.user.id, questionId, isCorrect, timeSpentMs ?? 0);

  return NextResponse.json({
    correct: isCorrect,
    explanation: q.explanation ?? null,
    correctOptionId: correctOption?.id ?? null,
  });
}
