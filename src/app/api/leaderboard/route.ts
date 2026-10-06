import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { getLeaderboard, getProfile, getXpHistory } from "@/features/gamification/queries";
import { getCachedLeaderboard } from "@/shared/query-cache";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = request.nextUrl.searchParams.get("userId");
  if (userId) {
    if (userId !== session.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const profile = await getProfile(userId);
    const history = await getXpHistory(userId);
    return NextResponse.json({ profile, history });
  }

  const leaderboard = await getCachedLeaderboard(20);
  const myProfile = await getProfile(session.user.id);
  const myRank = leaderboard.findIndex((r) => r.userId === session.user.id) + 1;

  return NextResponse.json({ leaderboard, myProfile, myRank });
}
