import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/shared/session";
import { eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { practicalQuestion } from "@/features/practical/schema";

async function GET() {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;
  const rows = await db
    .select({
      id: practicalQuestion.id,
      questionType: practicalQuestion.questionType,
      reviewStatus: practicalQuestion.reviewStatus,
      status: practicalQuestion.status,
      prompt: practicalQuestion.prompt,
      sourceMaterial: practicalQuestion.sourceMaterial,
      sourcePage: practicalQuestion.sourcePage,
      imageId: practicalQuestion.imageId,
      groupId: practicalQuestion.groupId,
      order: practicalQuestion.order,
      correctOptionId: practicalQuestion.correctOptionId,
    })
    .from(practicalQuestion)
    .orderBy(practicalQuestion.order, practicalQuestion.id);
  return NextResponse.json({ questions: rows, user: guard.session.user });
}

const actionBody = z.object({
  questionId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
});

async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard.error) return guard.error;
  const body = await req.json();
  const { questionId, action } = actionBody.parse(body);

  const row = await db.query.practicalQuestion.findFirst({ where: eq(practicalQuestion.id, questionId) });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!["AUTO_VERIFIED_SOURCE", "NEEDS_REVIEW"].includes(row.reviewStatus)) {
    return NextResponse.json({ error: "cannot_approve", reviewStatus: row.reviewStatus }, { status: 409 });
  }

  const reviewStatus = action === "approve" ? "APPROVED" : "REJECTED";
  const status = action === "approve" ? "APPROVED" : "REJECTED";
  await db.update(practicalQuestion).set({ reviewStatus, status } as Record<string, string>).where(eq(practicalQuestion.id, questionId));
  return NextResponse.json({ questionId, reviewStatus, status });
}

export { GET, POST };
