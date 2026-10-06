import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { createBattle, joinBattle, getBattle, getUserBattles } from "@/features/gamification/battles";
import { battleCreateSchema } from "@/shared/validation";
import { getAccessibleQuestionBankBySlug } from "@/features/access/learning-access";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const battleId = request.nextUrl.searchParams.get("id");
  if (battleId) {
    const b = await getBattle(battleId);
    if (!b || !b.participants.some((participant: { userId: string }) => participant.userId === session.user.id)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const bankAccess = await getAccessibleQuestionBankBySlug(session.user, b.bank_slug);
    if (!bankAccess.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(b);
  }

  const battles = await getUserBattles(session.user.id);
  return NextResponse.json({ battles });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "create") {
    const parsed = battleCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "validation", details: parsed.error.issues }, { status: 400 });
    }
    const bankAccess = await getAccessibleQuestionBankBySlug(session.user, parsed.data.bankSlug);
    if (!bankAccess.ok) return NextResponse.json({ error: "quiz not found" }, { status: 404 });
    const battleId = await createBattle(session.user.id, parsed.data.bankSlug, parsed.data.questionCount);
    return NextResponse.json({ battleId });
  }

  if (body.action === "join") {
    if (typeof body.battleId !== "string" || body.battleId.length === 0) {
      return NextResponse.json({ error: "battleId required" }, { status: 400 });
    }
    const battle = await getBattle(body.battleId);
    if (!battle) return NextResponse.json({ error: "battle unavailable" }, { status: 404 });
    const bankAccess = await getAccessibleQuestionBankBySlug(session.user, battle.bank_slug);
    if (!bankAccess.ok) return NextResponse.json({ error: "battle unavailable" }, { status: 404 });
    const result = await joinBattle(body.battleId, session.user.id);
    if (!result) return NextResponse.json({ error: "battle unavailable" }, { status: 400 });
    return NextResponse.json({ battleId: result });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
