import { getSession } from "@/shared/session";
import { practicalGenerateBody, practicalFailure, privateHeaders } from "@/features/practical/http";
import { reserveAiUsageSlot, FREE_DAILY_LIMIT, recordAiUsage } from "@/features/ai/queries";
import { beginGeneration, finalizeGeneration } from "@/features/gamification/idempotency";
import { generateJson } from "@/shared/ai-client";
import { eq } from "drizzle-orm";
import { practicalImage, practicalQuestion } from "@/features/practical/schema";
import { db } from "@/shared/db";
import { randomUUID } from "crypto";
import { z } from "zod";

const SYSTEM_PROMPT_PRACTICAL = `You are a medical education assistant. Create a realistic medical image identification question based on the provided image description and target structure.
Return ONLY valid JSON in exactly this shape with no extra text:
{
  "prompt": "What is the structure indicated by the arrow?",
  "options": ["option1", "option2", "option3", "option4", "option5"],
  "correctOptionId": "option_id_of_correct_answer",
  "explanation": "Brief explanation of why the correct answer is correct",
  "identifyingClue": "A key visual feature to identify the structure",
  "commonMistake": "A common confusion students have",
  "examTip": "A practical tip for identifying this structure in exams"
}`;

const AIPracticalResponseSchema = z.object({
  prompt: z.string(),
  options: z.array(z.string()).length(5),
  correctOptionId: z.string(),
  explanation: z.string(),
  identifyingClue: z.string(),
  commonMistake: z.string(),
  examTip: z.string(),
});

type AIPracticalResponse = z.infer<typeof AIPracticalResponseSchema>;

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders });

    let body: z.infer<typeof practicalGenerateBody>;
    try {
      body = practicalGenerateBody.parse(await request.json());
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400, headers: privateHeaders });
    }

    const sessionUser = session.user;

    // Idempotency: replay the exact stored result for a reused key (scoped to the
    // same user), never a second generation or a second quota charge.
    const idempotent = await beginGeneration({
      userId: sessionUser.id,
      idempotencyKey: body.idempotencyKey,
      feature: "practical",
    });
    if (idempotent.kind === "completed") {
      const stored = (idempotent.result ?? {}) as Record<string, unknown>;
      return Response.json({ ...stored, duplicate: true }, { headers: privateHeaders });
    }
    if (idempotent.kind === "pending") {
      return Response.json({ error: "generation_in_progress" }, { status: 409, headers: privateHeaders });
    }

    // Shared study-generation quota applies to every user (no subscription bypass).
    const reservation = await reserveAiUsageSlot(sessionUser.id);
    if (!reservation.ok) {
      return Response.json(
        { error: "daily_limit", message: `Daily AI generation limit (${FREE_DAILY_LIMIT}) reached` },
        { status: 429, headers: privateHeaders },
      );
    }

    // Verify source image exists and user has access
    const sourceImage = await db.query.practicalImage.findFirst({
      where: eq(practicalImage.id, body.sourceImageId),
    });

    if (!sourceImage) {
      return Response.json({ error: "Source image not found" }, { status: 404, headers: privateHeaders });
    }

    const track = await db.query.practicalTrack.findFirst({
      where: (pt, { eq }) => eq(pt.id, sourceImage.trackId ?? ""),
    });

    if (!track) {
      return Response.json({ error: "Track not found" }, { status: 404, headers: privateHeaders });
    }

    const { getAccessibleModuleBySlug } = await import("@/features/access/learning-access");
    const access = await getAccessibleModuleBySlug({ id: session.user.id, role: session.user.role }, sourceImage.moduleId);
    if (!access.ok) {
      return Response.json({ error: "Module access required" }, { status: 403, headers: privateHeaders });
    }

    // Generate the question
    try {
      const prompt = `Create a medical image identification question for a practical exam.
Source image description: ${sourceImage.alt}
Target structure coordinates: x=${body.targetX}, y=${body.targetY}
${body.prompt ? `Additional context: ${body.prompt}` : ""}

Generate a medical image identification question with exactly 5 options.`;

      const { data, inputTokens, outputTokens } = await generateJson<AIPracticalResponse>({
        system: SYSTEM_PROMPT_PRACTICAL,
        user: prompt,
      });

      const aiResponse = data;

      if (!aiResponse || !aiResponse.options || aiResponse.options.length !== 5 || !aiResponse.correctOptionId) {
        throw new Error("Invalid AI response format");
      }

      // Create the practical image for the exam derivative
      const examImageId = randomUUID();
      await db.insert(practicalImage).values({
        id: examImageId,
        moduleId: sourceImage.moduleId,
        studyYear: sourceImage.studyYear,
        subject: sourceImage.subject,
        storageKey: `exam_${sourceImage.id}_${Date.now()}`,
        alt: `Exam derivative of ${sourceImage.alt}`,
        sourceMaterial: { title: "Exam derivative", path: "", sha256: "", approvedBy: null, approvedAt: null },
        sourcePage: sourceImage.sourcePage,
        markers: [],
        status: "APPROVED",
        isFixture: false,
        sourceImageId: body.sourceImageId,
        examImageId: null,
        targetX: body.targetX,
        targetY: body.targetY,
        isExamDerivative: true,
        generationStatus: "COMPLETED",
        reviewStatus: "APPROVED",
        generatedByAi: true,
      });

      // Create the practical question
      const questionId = randomUUID();
      const optionIds = aiResponse.options.map((_, i) => `opt_${i}`);
      const correctIndex = aiResponse.options.findIndex(o => o === aiResponse.correctOptionId);
      const correctOptionId = optionIds[correctIndex >= 0 ? correctIndex : 0];

      const result = { questionId, examImageId, duplicate: false };

      await db.insert(practicalQuestion).values({
        id: questionId,
        trackId: track.id,
        moduleId: sourceImage.moduleId,
        studyYear: sourceImage.studyYear,
        subject: sourceImage.subject,
        sourceMaterial: { title: "AI Generated", path: "", sha256: "", approvedBy: null, approvedAt: null },
        sourcePage: 1,
        questionType: "IMAGE_IDENTIFICATION",
        answerFormat: "SINGLE_CHOICE",
        imageId: examImageId,
        markerIds: [],
        groupId: "ai_generated",
        order: 0,
        prompt: aiResponse.prompt || "What is the structure indicated by the arrow?",
        options: aiResponse.options.map((text, i) => ({ id: `opt_${i}`, text })),
        correctOptionId,
        explanation: aiResponse.explanation,
        identifyingClue: aiResponse.identifyingClue,
        commonMistake: aiResponse.commonMistake,
        examTip: aiResponse.examTip,
        status: "APPROVED",
        isFixture: false,
        sourceImageId: body.sourceImageId,
        examImageId: examImageId,
        targetX: body.targetX,
        targetY: body.targetY,
        generationRequestId: body.idempotencyKey,
        generationStatus: "COMPLETED",
        reviewStatus: "APPROVED",
        generatedByAi: true,
      });

      await recordAiUsage({
        userId: sessionUser.id,
        lectureId: null,
        model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
      });

      await finalizeGeneration({
        userId: sessionUser.id,
        idempotencyKey: body.idempotencyKey,
        status: "completed",
        result,
      });

      return Response.json(result, { headers: privateHeaders });
    } catch (err) {
      if (idempotent.kind === "new") {
        await finalizeGeneration({
          userId: sessionUser.id,
          idempotencyKey: body.idempotencyKey,
          status: "failed",
          result: { error: (err as Error).message },
        });
      }
      console.error("Practical generation error:", err);
      return Response.json({ error: "Generation failed" }, { status: 500, headers: privateHeaders });
    }
  } catch (error) {
    return practicalFailure(error);
  }
}