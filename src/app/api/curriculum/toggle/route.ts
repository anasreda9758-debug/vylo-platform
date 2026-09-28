import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { lectureProgress } from "@/features/curriculum/schema";
import { awardXp, updateStreak, hasEarnedLectureCompletionXp } from "@/features/gamification/queries";
import { getAccessibleLecture } from "@/features/access/learning-access";
import { safeAwardXp, safeUpdateStreak } from "@/features/gamification/error-handling";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let lectureId: string;
  let moduleSlug: string | null = null;
  try {
    const body = await request.json();
    if (typeof body.lectureId !== "string" || body.lectureId.length === 0) {
      return NextResponse.json({ error: "invalid lectureId" }, { status: 400 });
    }
    lectureId = body.lectureId;
    if (typeof body.moduleSlug === "string") moduleSlug = body.moduleSlug;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const lectureAccess = await getAccessibleLecture(session.user, lectureId, { allowPreview: true });
  if (!lectureAccess.ok) return NextResponse.json({ error: "lecture not found" }, { status: 404 });
  const lectureRow = lectureAccess.value;
  if (moduleSlug && moduleSlug !== lectureRow.module.slug) moduleSlug = null;

  const existing = await db
    .select({ id: lectureProgress.id })
    .from(lectureProgress)
    .where(
      and(
        eq(lectureProgress.userId, session.user.id),
        eq(lectureProgress.lectureId, lectureId),
      ),
    )
    .limit(1);

  let completed: boolean;
  try {
    if (existing.length > 0) {
      await db.delete(lectureProgress).where(eq(lectureProgress.id, existing[0].id));
      completed = false;
    } else {
      await db.insert(lectureProgress).values({
        id: randomUUID(),
        userId: session.user.id,
        lectureId,
      });
      completed = true;
    }
  } catch {
    return NextResponse.json({ error: "progress could not be updated" }, { status: 400 });
  }

  // XP and streak are best-effort after the progress write has committed. A
  // transient gamification failure must never appear as a progress failure.
  if (completed) {
    try {
      const alreadyEarned = await hasEarnedLectureCompletionXp(session.user.id, lectureId);
      if (!alreadyEarned) {
        await safeAwardXp(
          () => awardXp(session.user.id, "lecture_complete", lectureId),
          (msg, err) => console.warn(`[toggle] ${msg}`, err),
        );
        await safeUpdateStreak(
          () => updateStreak(session.user.id),
          (msg, err) => console.warn(`[toggle] ${msg}`, err),
        );
      }
    } catch (err) {
      console.warn("[toggle] non-fatal XP/streak failure", err);
    }
  }

  revalidatePath("/curriculum");
  revalidatePath("/dashboard");
  if (moduleSlug) revalidatePath(`/curriculum/${moduleSlug}`);

  return NextResponse.json({ completed });
}
