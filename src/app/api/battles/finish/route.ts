import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { finishBattle, getBattle } from "@/features/gamification/battles";
import { awardXp } from "@/features/gamification/queries";
import { battleFinishSchema } from "@/shared/validation";
import { getAccessibleQuestionBankBySlug } from "@/features/access/learning-access";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let battleId: string;
  try {
    const body = await request.json();
    const parsed = battleFinishSchema.parse(body);
    battleId = parsed.battleId;
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
  if (battle.status !== "active") return NextResponse.json({ error: "battle is not active" }, { status: 400 });
  const bankAccess = await getAccessibleQuestionBankBySlug(session.user, battle.bank_slug);
  if (!bankAccess.ok) return NextResponse.json({ error: "battle not found" }, { status: 404 });

  const result = await finishBattle(battleId);

  if (result.winnerId === session.user.id) {
    await awardXp(session.user.id, "battle_win", battleId);
  } else if (!result.winnerId) {
    // tie
  } else {
    await awardXp(session.user.id, "battle_lose", battleId);
  }

  return NextResponse.json(result);
}
