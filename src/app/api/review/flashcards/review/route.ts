import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { reviewFlashcard } from "@/features/review/queries";
import { awardXp } from "@/features/gamification/queries";
import { getAccessibleFlashcard } from "@/features/access/learning-access";
import { safeAwardXpGeneral } from "@/features/gamification/error-handling";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let cardId: string;
  let rating: "again" | "good" | "easy";
  try {
    const body = await request.json();
    if (typeof body.cardId !== "string" || body.cardId.length === 0) {
      return NextResponse.json({ error: "invalid cardId" }, { status: 400 });
    }
    if (!["again", "good", "easy"].includes(body.rating)) {
      return NextResponse.json({ error: "invalid rating" }, { status: 400 });
    }
    cardId = body.cardId;
    rating = body.rating;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const access = await getAccessibleFlashcard(session.user, cardId);
  if (!access.ok) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const { wasDue } = await reviewFlashcard(cardId, session.user.id, rating);
  if (wasDue) {
    await safeAwardXpGeneral(
      () => awardXp(session.user.id, "flashcard_review", cardId),
      (msg, err) => console.warn(`[flashcard_review] ${msg}`, err),
    );
  }
  return NextResponse.json({ ok: true, xpEarned: wasDue });
}