import { getSession } from "@/shared/session";
import { practicalGenerateBody, practicalFailure, privateHeaders } from "@/features/practical/http";
import { reserveAiUsageSlot, FREE_DAILY_LIMIT, recordAiUsage } from "@/features/ai/queries";
import { beginGeneration, finalizeGeneration } from "@/features/gamification/idempotency";
import { generateJson } from "@/shared/ai-client";
import { eq } from "drizzle-orm";
import { practicalImage, practicalQuestion } from "@/features/practical/schema";
import { buildFiveOptions } from "@/features/practical/authoring";
import { getAccessibleModuleBySlug } from "@/features/access/learning-access";
import { db } from "@/shared/db";
import { randomUUID } from "crypto";
import { z } from "zod";
import { readBoundedJson, RequestBodyTooLarge } from "@/shared/bounded-json";

const SYSTEM_PROMPT_PRACTICAL = `You are a medical education assistant building a practical spotter question.
The examiner has ALREADY verified the correct structure; you must NOT invent or choose the correct answer.
Generate exactly four plausible WRONG distractor structures (nearby/neighboring structures, same tissue or anatomical region) plus short teaching aids.
Return ONLY valid JSON in exactly this shape with no extra text:
{
  "distractors": ["wrong1", "wrong2", "wrong3", "wrong4"],
  "explanation": "Brief reason the correct structure is correct",
  "identifyingClue": "A key visual feature",
  "commonMistake": "A common confusion",
  "examTip": "A practical exam tip"
}`;

const AIPracticalResponseSchema = z.object({
  distractors: z.array(z.string()).default([]),
  explanation: z.string().optional(),
  identifyingClue: z.string().optional(),
  commonMistake: z.string().optional(),
  examTip: z.string().optional(),
});

type AIPracticalResponse = z.infer<typeof AIPracticalResponseSchema>;

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders });

    let body: z.infer<typeof practicalGenerateBody>;
    try {
      body = practicalGenerateBody.parse(await readBoundedJson(request, 32 * 1024));
    } catch (error) {
      if (error instanceof RequestBodyTooLarge) return Response.json({ error: "request_too_large" }, { status: 413, headers: privateHeaders });
      return Response.json({ error: "invalid json" }, { status: 400, headers: privateHeaders });
    }

    const sessionUser = session.user;

    // Authoring context: source image, track, module access — resolved BEFORE the
    // idempotency check so a reused key is bound to the same source.
    const sourceImage = await db.query.practicalImage.findFirst({
      where: eq(practicalImage.id, body.sourceImageId),
    });
    if (!sourceImage) {
      return Response.json({ error: "Source image not found" }, { status: 404, headers: privateHeaders });
    }
    // Never fabricate a track: an un-tracked source can't produce a derivative that
    // the student catalog (inner-join on practical_track_id) would ever surface.
    if (!sourceImage.trackId) {
      return Response.json({ error: "Source image has no practical track" }, { status: 409, headers: privateHeaders });
    }
    const track = await db.query.practicalTrack.findFirst({
      where: (pt, { eq: eqT }) => eqT(pt.id, sourceImage.trackId ?? ""),
    });
    if (!track) {
      return Response.json({ error: "Track not found" }, { status: 404, headers: privateHeaders });
    }
    const access = await getAccessibleModuleBySlug({ id: session.user.id, role: session.user.role }, sourceImage.moduleId);
    if (!access.ok) {
      return Response.json({ error: "Module access required" }, { status: 403, headers: privateHeaders });
    }

    const examImage =
      body.examImageId && body.examImageId.length > 0
        ? await db.query.practicalImage.findFirst({ where: eq(practicalImage.id, body.examImageId) })
        : null;
    if (body.examImageId && body.examImageId.length > 0 && !examImage) {
      return Response.json({ error: "Exam image not found" }, { status: 404, headers: privateHeaders });
    }
    // A pre-supplied clean exam image must belong to the same track as the source,
    // otherwise the approved artifact would be invisible to every student scope.
    if (examImage && examImage.trackId !== track.id) {
      return Response.json({ error: "Exam image belongs to a different practical track" }, { status: 409, headers: privateHeaders });
    }

    // Idempotency is user-scoped and bound to feature + source (track). A replayed
    // key returns the stored result; the same key for a DIFFERENT source is 409.
    const idempotent = await beginGeneration({
      userId: sessionUser.id,
      idempotencyKey: body.idempotencyKey,
      feature: "practical",
      practicalTrackId: track.id,
    });
    if (idempotent.kind === "completed") {
      const stored = (idempotent.result ?? {}) as Record<string, unknown>;
      return Response.json({ ...stored, duplicate: true }, { headers: privateHeaders });
    }
    if (idempotent.kind === "pending") {
      return Response.json({ error: "generation_in_progress" }, { status: 409, headers: privateHeaders });
    }
    if (idempotent.kind === "conflict") {
      return Response.json(
        { error: "idempotency_key_already_used_for_different_request" },
        { status: 409, headers: privateHeaders },
      );
    }

    const correctStructure = (body.correctStructure ?? "").trim();
    const needsVerifiedAnswer = correctStructure.length === 0;
    const needsCleanImage = !examImage;

    let generated: AIPracticalResponse | null = null;
    let aiSucceeded = false;
    if (!needsVerifiedAnswer) {
      if (process.env.USE_HOSTED_AI !== "true" || !process.env.GROQ_API_KEY) {
        return Response.json({ error: "hosted_ai_disabled" }, { status: 503, headers: privateHeaders });
      }
      // Reserve BEFORE spending. Failed/invalid replies can still cost;
      // they retain the slot rather than opening a free retry/concurrency bypass.
      const reservation = await reserveAiUsageSlot(sessionUser.id);
      if (!reservation.ok) {
        return Response.json(
          { error: "daily_limit", message: `Daily AI generation limit (${FREE_DAILY_LIMIT}) reached` },
          { status: 429, headers: privateHeaders },
        );
      }
      try {
        const prompt = `Create a medical image identification practical question.
Image description: ${sourceImage.alt.slice(0, 4000)}
Verified correct structure (DO NOT reveal or change it): ${correctStructure}
Target coordinates: x=${body.targetX}, y=${body.targetY}
${body.prompt ? `Additional context: ${body.prompt}` : ""}

Suggest four plausible distractors and teaching aids.`;
        const { data, inputTokens, outputTokens } = await generateJson<AIPracticalResponse>({
          system: SYSTEM_PROMPT_PRACTICAL,
          user: prompt,
        });
        const parsed = AIPracticalResponseSchema.safeParse(data ?? {});
        if (parsed.success) {
          generated = parsed.data;
          aiSucceeded = true;
        }
        await recordAiUsage({
          userId: sessionUser.id,
          lectureId: null,
          model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
        });
      } catch (err) {
        console.error("Practical generation error:", err);
        if (idempotent.kind === "new") {
          await finalizeGeneration({
            userId: sessionUser.id,
            idempotencyKey: body.idempotencyKey,
            status: "failed",
            result: { error: (err as Error).message },
          });
        }
        return Response.json({ error: "Generation failed" }, { status: 500, headers: privateHeaders });
      }
    }

    const five = buildFiveOptions(correctStructure, generated?.distractors ?? []);
    const needsReview = needsVerifiedAnswer || needsCleanImage || five.needsReview;
    const reviewStatus = needsReview ? "NEEDS_REVIEW" : "DRAFT";

    // The student-visible image is the CLEAN EXAM version, never the labeled
    // source. If no clean image was supplied the derivative is created as a
    // pending draft: it cannot be approved (and therefore never reaches students).
    let imageId = examImage ? examImage.id : null;
    if (!imageId) {
      imageId = randomUUID();
      await db.insert(practicalImage).values({
        id: imageId,
        trackId: track.id,
        moduleId: sourceImage.moduleId,
        studyYear: sourceImage.studyYear,
        subject: sourceImage.subject,
        storageKey: "",
        alt: `Pending clean exam version of ${sourceImage.alt}`,
        sourceMaterial: {
          title: "Pending clean exam version",
          path: `exam-derivative:${imageId}`,
          sha256: "",
          approvedBy: null,
          approvedAt: null,
        },
        sourcePage: sourceImage.sourcePage,
        markers: [],
        status: "DRAFT_AI",
        isFixture: false,
        sourceImageId: body.sourceImageId,
        examImageId: null,
        targetX: body.targetX,
        targetY: body.targetY,
        isExamDerivative: true,
        generationStatus: needsReview ? "NEEDS_REVIEW" : "COMPLETED",
        reviewStatus: "NEEDS_REVIEW",
        generatedByAi: aiSucceeded,
      });
    }

    const questionId = randomUUID();
    const result = { questionId, examImageId: imageId, duplicate: false, reviewStatus };

    await db.insert(practicalQuestion).values({
      id: questionId,
      trackId: track.id,
      moduleId: sourceImage.moduleId,
      studyYear: sourceImage.studyYear,
      subject: sourceImage.subject,
      sourceMaterial: {
        title: "AI-assisted authoring",
        path: sourceImage.storageKey,
        sha256: "",
        approvedBy: null,
        approvedAt: null,
      },
      sourcePage: sourceImage.sourcePage,
      questionType: "IMAGE_IDENTIFICATION",
      answerFormat: "SINGLE_CHOICE",
      imageId,
      markerIds: [],
      groupId: "spotter_generated",
      order: 0,
      prompt: correctStructure ? "Identify the structure indicated by the arrow." : "Pending verified structure.",
      options: five.options as { id: string; text: string }[],
      correctOptionId: five.correctOptionId,
      explanation: generated?.explanation ?? "",
      identifyingClue: generated?.identifyingClue ?? "",
      commonMistake: generated?.commonMistake ?? "",
      examTip: generated?.examTip ?? "",
      status: "DRAFT_AI",
      isFixture: false,
      sourceImageId: body.sourceImageId,
      examImageId: imageId,
      targetX: body.targetX,
      targetY: body.targetY,
      correctStructure: correctStructure.length > 0 ? correctStructure : null,
      generationRequestId: idempotent.requestId,
      generationStatus: needsReview ? "NEEDS_REVIEW" : "COMPLETED",
      reviewStatus,
      generatedByAi: aiSucceeded,
    });

    if (idempotent.kind === "new") {
      await finalizeGeneration({
        userId: sessionUser.id,
        idempotencyKey: body.idempotencyKey,
        status: "completed",
        result,
      });
    }

    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return practicalFailure(error);
  }
}
