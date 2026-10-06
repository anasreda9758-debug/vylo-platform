import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { getOspeModuleAccess } from "@/features/ospe/queries";
import { db } from "@/shared/db";
import { practicalTrack } from "@/features/practical/schema";
import { practicalTrackOspeStation } from "@/features/ospe/schema";
import { curriculumModule } from "@/features/curriculum/schema";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = await getOspeModuleAccess(session.user);
  const approvedByModule = new Map<string, number>();
  for (const item of access) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(practicalTrackOspeStation)
      .innerJoin(practicalTrack, eq(practicalTrackOspeStation.trackId, practicalTrack.id))
      .innerJoin(curriculumModule, eq(practicalTrack.moduleId, curriculumModule.id))
      .where(and(
        eq(curriculumModule.slug, item.moduleSlug),
        eq(practicalTrack.status, "PUBLISHED"),
        eq(practicalTrack.ospeEnabled, true),
      ));
    approvedByModule.set(item.moduleSlug, Number(row?.count ?? 0));
  }

  return NextResponse.json({
    modules: access
      .map((a) => ({ ...a, count: approvedByModule.get(a.moduleSlug) ?? 0 }))
      .filter((a) => a.count > 0),
  });
}
