import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/shared/session";
import { finishAttempt } from "@/features/practice/queries";
import { quizFinishSchema } from "@/shared/validation";
import { updateStreak } from "@/features/gamification/queries";
import { getAccessibleQuizAttempt } from "@/features/access/learning-access";
import { safeUpdateStreak } from "@/features/gamification/error-handling";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let attemptId: string;
  try {
    const body = await request.json();
    const parsed = quizFinishSchema.parse(body);
    attemptId = parsed.attemptId;
  } catch (e: any) {
    if (e?.issues) {
      return NextResponse.json({ error: "validation", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const access = await getAccessibleQuizAttempt(session.user, attemptId);
  if (!access.ok) return NextResponse.json({ error: "attempt not found" }, { status: 404 });

  const result = await finishAttempt(session.user.id, attemptId);
  if (!result) {
    return NextResponse.json({ error: "attempt not found" }, { status: 404 });
  }

  await safeUpdateStreak(
    () => updateStreak(session.user.id),
    (msg, err) => console.warn(`[quiz_finish] ${msg}`, err),
  );

  revalidatePath("/dashboard");
  return NextResponse.json(result);
}
