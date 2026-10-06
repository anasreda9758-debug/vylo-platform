import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { answerBattleQuestion, getBattle } from "@/features/gamification/battles";
import { battleAnswerSchema } from "@/shared/validation";
import {
  getAccessibleQuestion,
  getAccessibleQuestionBankBySlug,
  questionBelongsToBank,
} from "@/features/access/learning-access";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let battleId: string;
  let questionId: string;
  let optionId: string;
  try {
    const body = await request.json();
    const parsed = battleAnswerSchema.parse(body);
    battleId = parsed.battleId;
    questionId = parsed.questionId;
    optionId = parsed.optionId;
  } catch (e: any) {
    if (e?.issues) {
      return NextResponse.json({ error: "validation", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const battle = await getBattle(battleId);
  if (!battle || !battle.participants.some((participant: { userId: string }) => participant.userId === session.user.id)) {
    return NextResponse.json({ error: "battle not found" }, { status: 404 });
  }
  const bankAccess = await getAccessibleQuestionBankBySlug(session.user, battle.bank_slug);
  const questionAccess = await getAccessibleQuestion(session.user, questionId);
  if (!bankAccess.ok || !questionAccess.ok || !questionBelongsToBank(questionAccess.value.bankId, bankAccess.value.id)) {
    return NextResponse.json({ error: "question not found" }, { status: 404 });
  }
  const selectedOption = questionAccess.value.options.find((option) => option.id === optionId);
  if (!selectedOption) return NextResponse.json({ error: "option not found" }, { status: 404 });

  await answerBattleQuestion(battleId, session.user.id, questionId, optionId, selectedOption.isCorrect);

  return NextResponse.json({ correct: selectedOption.isCorrect });
}
