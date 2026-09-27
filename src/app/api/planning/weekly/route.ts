import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { getWeeklyPlan } from "@/features/planning/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/planning/weekly
 *
 * Deterministic weekly study plan. Requires a session: the plan is built from
 * the signed-in student's own progress, so it must never be cached publicly.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("dailyMinutes");
  const dailyMinutes = raw === null ? undefined : Number(raw);
  if (dailyMinutes !== undefined && (!Number.isFinite(dailyMinutes) || dailyMinutes < 5 || dailyMinutes > 600)) {
    return NextResponse.json({ error: "invalid dailyMinutes" }, { status: 400 });
  }

  try {
    const plan = await getWeeklyPlan(session.user.id, { dailyMinutes });
    return NextResponse.json({ plan });
  } catch (error) {
    // A planning failure must surface as an error state, never a spinner.
    console.error("[planning/weekly] failed", error);
    return NextResponse.json({ error: "Could not build your weekly plan. Please retry." }, { status: 500 });
  }
}
