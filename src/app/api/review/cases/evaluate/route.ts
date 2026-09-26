import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { reserveAiUsageSlot, FREE_DAILY_LIMIT, recordAiUsage } from "@/features/ai/queries";
import { generateJson } from "@/shared/ai-client";
import { awardXp } from "@/features/gamification/queries";
import { evaluateSourceAnswers } from "@/features/review/source-generators";
import { createClinicalCaseEvaluation } from "@/features/review/queries";
import { getAccessibleClinicalCase } from "@/features/access/learning-access";
import { safeAwardXpGeneral } from "@/features/gamification/error-handling";

const SYSTEM_PROMPT =
  "You are a medical examiner. Evaluate the student's answers against the model answers. Give clear, concise feedback " +
  "with strengths, missing points, and an overall score out of 100. Return ONLY valid JSON in this shape: " +
  '{"score": 0, "feedback": "..."}.';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let caseId: string;
  let answers: string[];
  try {
    const body = await request.json();
    if (typeof body.caseId !== "string" || body.caseId.length === 0) {
      return NextResponse.json({ error: "invalid caseId" }, { status: 400 });
    }
    if (!Array.isArray(body.answers) || body.answers.length === 0) {
      return NextResponse.json({ error: "invalid answers" }, { status: 400 });
    }
    caseId = body.caseId;
    answers = body.answers.map((a: unknown) => String(a ?? ""));
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const access = await getAccessibleClinicalCase(session.user, caseId);
  if (!access.ok) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const caseRow = access.value.case;

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

  const questions = JSON.parse(caseRow.questionsJson) as string[];
  const modelAnswers = JSON.parse(caseRow.modelAnswersJson) as string[];
  const joined = answers.map((a, i) => `Q${i + 1}: ${a}`).join("\n");

  const recordEvaluation = async (score: number | null, feedback?: string) => {
    try {
      await createClinicalCaseEvaluation({
        caseId,
        userId: session.user.id,
        answers,
        score: score ?? 0,
        feedback,
      });
    } catch (err) {
      console.warn("[clinical_case_evaluation] persistence skipped", err);
    }
  };

  const awardOnceEverXp = () =>
    safeAwardXpGeneral(
      () => awardXp(session.user.id, "case_complete", caseId),
      (msg, err) => console.warn(`[case_complete] ${msg}`, err),
    );

const evaluateLocally = async () => {
    const result = await evaluateSourceAnswers(answers, modelAnswers);
    await recordEvaluation(result.score, result.feedback);
    await awardOnceEverXp();
    return NextResponse.json({ ...result, source: "lecture" });
  };
  if (!process.env.GROQ_API_KEY) return evaluateLocally();

  try {
    const { data, inputTokens, outputTokens } = await generateJson<{ score: number; feedback: string }>({
      system: SYSTEM_PROMPT,
      user: `QUESTIONS:\n${JSON.stringify(questions)}\n\nMODEL ANSWERS:\n${JSON.stringify(modelAnswers)}\n\nSTUDENT:\n${joined}`,
    });
    await recordAiUsage({
      userId: session.user.id,
      lectureId: caseRow.lectureId,
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      inputTokens,
      outputTokens,
    });
    await recordEvaluation(data?.score ?? null, data?.feedback);
    await awardOnceEverXp();
    return NextResponse.json({
      score: data?.score ?? null,
      feedback: data?.feedback ?? "لم نتمكن من توليد تقييم.",
    });
  } catch (err) {
    console.error("case evaluate error:", err);
    return evaluateLocally();
  }
}