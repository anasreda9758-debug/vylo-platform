import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { reserveAiUsageSlot, FREE_DAILY_LIMIT, recordAiUsage } from "@/features/ai/queries";
import { beginGeneration, finalizeGeneration } from "@/features/gamification/idempotency";
import { generateJson } from "@/shared/ai-client";
import { createClinicalCase, listMyCases } from "@/features/review/queries";
import { createSourceClinicalCase } from "@/features/review/source-generators";
import { getAccessibleClinicalCase, getAccessibleLecture } from "@/features/access/learning-access";

const SYSTEM_PROMPT =
  "You are a medical educator. Create one realistic medical clinical case based strictly on the content given. " +
  'Return ONLY valid JSON, in English, in exactly this shape with no extra text: ' +
  '{"case": "...", "questions": ["...", "...", "..."], "model_answers": ["...", "...", "..."]}. ' +
  "Do not add information not supported by the source.";

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
      feature: "case",
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
  const createLocalCase = async (): Promise<{
    caseId: string;
    case: string;
    questions: string[];
    source: string;
  }> => {
    const data = createSourceClinicalCase(lectureRow.title, body, lectureRow.summaryJson);
    if (data.questions.length === 0) {
      throw Object.assign(new Error("no_usable_content"), { status: 400 });
    }
    const caseId = await createClinicalCase(session.user.id, lectureId, data);
    return { caseId, case: data.case, questions: data.questions, source: "lecture" };
  };

  const respond = async (result: { caseId: string; case: string; questions: string[]; source?: string; duplicate?: boolean }) => {
    if (idempotencyKey) {
      await finalizeGeneration({ userId: session.user.id, idempotencyKey, status: "completed", result });
    }
    return NextResponse.json(result);
  };

  if (process.env.USE_HOSTED_AI !== "true" || !process.env.GROQ_API_KEY) {
    try {
      return await respond(await createLocalCase());
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
    const { data, inputTokens, outputTokens } = await generateJson<{
      case: string;
      questions: string[];
      model_answers: string[];
    }>({
      system: SYSTEM_PROMPT,
      user: `Create one clinical case.\nContent:\n${body}`,
    });
    if (
      !data ||
      typeof data.case !== "string" ||
      !Array.isArray(data.questions) ||
      !Array.isArray(data.model_answers)
    ) {
      return await respond(await createLocalCase());
    }
    const caseId = await createClinicalCase(session.user.id, lectureId, data);
    await recordAiUsage({
      userId: session.user.id,
      lectureId,
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      inputTokens,
      outputTokens,
    });
    return await respond({ caseId, case: data.case, questions: data.questions });
  } catch (err) {
    console.error("clinical case error:", err);
    try {
      return await respond(await createLocalCase());
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
  const myCases = await listMyCases(session.user.id);
  const cases = [] as typeof myCases;
  for (const caseRow of myCases) {
    const access = await getAccessibleClinicalCase(session.user, caseRow.id);
    if (access.ok) cases.push(caseRow);
  }
  return NextResponse.json({
    cases: cases.map((c) => ({
      id: c.id,
      caseText: c.caseText,
      questions: JSON.parse(c.questionsJson) as string[],
      lectureTitle: c.lecture?.title ?? null,
      createdAt: c.createdAt,
    })),
  });
}