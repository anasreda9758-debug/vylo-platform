import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { reserveAiUsageSlot, FREE_DAILY_LIMIT, recordAiUsage } from "@/features/ai/queries";
import { beginGeneration, finalizeGeneration } from "@/features/gamification/idempotency";
import { generateJson } from "@/shared/ai-client";
import { createFlashcards, getDueFlashcards } from "@/features/review/queries";
import { createSourceFlashcards } from "@/features/review/source-generators";
import { getAccessibleLecture } from "@/features/access/learning-access";

const SYSTEM_PROMPT =
  "You are a medical education assistant. Create concise medical flashcards strictly from the content given. " +
  "Return ONLY valid JSON, in English, in exactly this shape with no extra text: " +
  '[{"front": "question or term", "back": "answer"}]. Stay strictly inside the source content.';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let lectureId: string;
  let idempotencyKey: string | null = null;
  try {
    const body = await request.json();
    if (typeof body.lectureId !== "string" || body.lectureId.length === 0) {
      return NextResponse.json({ error: "invalid lectureId" }, { status: 400 });
    }
    if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== "string") {
      return NextResponse.json({ error: "invalid idempotencyKey" }, { status: 400 });
    }
    lectureId = body.lectureId;
    idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0 ? body.idempotencyKey : null;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const lectureAccess = await getAccessibleLecture(session.user, lectureId, { allowPreview: false });
  if (!lectureAccess.ok) return NextResponse.json({ error: "lecture not found" }, { status: 404 });
  const lectureRow = lectureAccess.value;
  if (!lectureRow.content || lectureRow.content.trim().length === 0) {
    return NextResponse.json({ error: "no readable content for this lecture" }, { status: 400 });
  }

  // Idempotency: replay the exact stored result for a reused key, never a second generation.
  if (idempotencyKey) {
    const state = await beginGeneration({
      userId: session.user.id,
      idempotencyKey,
      feature: "flashcard",
      lectureId,
    });
    if (state.kind === "completed") {
      return NextResponse.json({ ...(state.result as object), duplicate: true });
    }
    if (state.kind === "pending") {
      return NextResponse.json({ error: "generation_in_progress" }, { status: 409 });
    }
    if (state.kind === "conflict") {
      return NextResponse.json(
        { error: "idempotency_key_already_used_for_different_request" },
        { status: 409 },
      );
    }
  }

  // Shared study-generation quota applies to every user (no subscription bypass).
  const reservation = await reserveAiUsageSlot(session.user.id);
  if (!reservation.ok) {
    return NextResponse.json(
      {
        error: "free_limit",
        message: `وصلت إلى حد ${FREE_DAILY_LIMIT} عملية ذكية مجانية اليوم.`,
      },
      { status: 429 },
    );
  }

  const body = lectureRow.content.slice(0, 15000);
  const createLocalCards = async (): Promise<{ count: number; source: string; warning?: string }> => {
    const { cards, warning } = createSourceFlashcards(lectureRow.title, body, lectureRow.summaryJson);
    if (cards.length === 0) {
      // Be explicit about *why* nothing could be made, instead of failing with
      // a generic error the student cannot act on.
      throw Object.assign(new Error(warning ?? "no_usable_content"), { status: 400, userMessage: warning });
    }
    const count = await createFlashcards(session.user.id, lectureId, cards);
    return { count, source: "lecture", warning: warning ?? undefined };
  };

  const respond = async (result: { count: number; source?: string; duplicate?: boolean }) => {
    if (idempotencyKey) {
      await finalizeGeneration({ userId: session.user.id, idempotencyKey, status: "completed", result });
    }
    return NextResponse.json(result);
  };

  if (process.env.USE_HOSTED_AI !== "true" || !process.env.GROQ_API_KEY) {
    try {
      return await respond(await createLocalCards());
    } catch (err) {
      if (idempotencyKey) {
        await finalizeGeneration({
          userId: session.user.id,
          idempotencyKey,
          status: "failed",
          result: { error: (err as Error).message },
        });
      }
      return NextResponse.json({ error: (err as Error).message }, { status: (err as { status?: number }).status ?? 400 });
    }
  }

  try {
    const { data, inputTokens, outputTokens } = await generateJson<{ front: string; back: string }[]>({
      system: SYSTEM_PROMPT,
      user: `Create 12 flashcards.\nContent:\n${body}`,
    });
    if (!data || data.length === 0) return await respond(await createLocalCards());
    const count = await createFlashcards(session.user.id, lectureId, data.slice(0, 12));
    await recordAiUsage({
      userId: session.user.id,
      lectureId,
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      inputTokens,
      outputTokens,
    });
    return await respond({ count });
  } catch (err) {
    console.error("flashcards error:", err);
    try {
      return await respond(await createLocalCards());
    } catch (fallbackErr) {
      if (idempotencyKey) {
        await finalizeGeneration({
          userId: session.user.id,
          idempotencyKey,
          status: "failed",
          result: { error: (fallbackErr as Error).message },
        });
      }
      return NextResponse.json({ error: (fallbackErr as Error).message }, { status: (fallbackErr as { status?: number }).status ?? 400 });
    }
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dueCards = await getDueFlashcards(session.user.id);
  const cards = [] as typeof dueCards;
  for (const card of dueCards) {
    const access = await getAccessibleLecture(session.user, card.lectureId, { allowPreview: false });
    if (access.ok) cards.push(card);
  }
  return NextResponse.json({
    cards: cards.map((c) => {
      // Legacy offline cards used a generic "key point 1" front or an
      // English-only template. Their stored review schedule must stay intact,
      // so only the displayed text is refreshed. Arabic fronts are kept as-is:
      // rewriting them into English would change the language of the material
      // the student is studying.
      const legacyIndex = c.front.match(/\s—\skey point\s(\d+)$/i)?.[1];
      const refreshed = c.lecture && legacyIndex
        ? createSourceFlashcards(
            c.lecture.title,
            c.lecture.content ?? "",
            c.lecture.summaryJson,
          ).cards[Number(legacyIndex) - 1]
        : null;
      return {
        id: c.id,
        front: refreshed?.front ?? c.front,
        back: refreshed?.back ?? c.back,
        lectureTitle: c.lecture?.title ?? null,
      };
    }),
  });
}