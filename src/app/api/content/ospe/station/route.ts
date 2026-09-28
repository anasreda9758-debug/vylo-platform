import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { getOspeModuleAccess } from "@/features/ospe/queries";
import { db } from "@/shared/db";
import { curriculumModule } from "@/features/curriculum/schema";
import { practicalTrack } from "@/features/practical/schema";
import { ospeAnswerKey, practicalTrackOspeStation } from "@/features/ospe/schema";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const folder = request.nextUrl.searchParams.get("folder") ?? "all";
  const access = await getOspeModuleAccess(session.user);

  // Pick only explicitly reviewed stations on published, OSPE-enabled tracks.
  const pools: { folder: string; fileName: string }[] = [];
  for (const a of access) {
    if (folder !== "all" && a.folder !== folder) continue;
    if (a.locked) continue;
    const stations = await db
      .select({ folder: ospeAnswerKey.folder, fileName: ospeAnswerKey.fileName })
      .from(practicalTrackOspeStation)
      .innerJoin(ospeAnswerKey, eq(practicalTrackOspeStation.answerKeyId, ospeAnswerKey.id))
      .innerJoin(practicalTrack, eq(practicalTrackOspeStation.trackId, practicalTrack.id))
      .innerJoin(curriculumModule, eq(practicalTrack.moduleId, curriculumModule.id))
      .where(and(
        eq(curriculumModule.slug, a.moduleSlug),
        eq(ospeAnswerKey.folder, a.folder),
        eq(practicalTrack.status, "PUBLISHED"),
        eq(practicalTrack.ospeEnabled, true),
      ));
    pools.push(...stations);
  }
  if (pools.length === 0) {
    return NextResponse.json({ error: "no accessible stations" }, { status: 403 });
  }

  const pick = pools[Math.floor(Math.random() * pools.length)];
  const meta = access.find((a) => a.folder === pick.folder);

  return NextResponse.json({
    folder: pick.folder,
    fileName: pick.fileName,
    moduleName: meta?.moduleName ?? null,
    moduleSlug: meta?.moduleSlug ?? null,
    url: `/api/content/ospe/image?folder=${encodeURIComponent(pick.folder)}&file=${encodeURIComponent(pick.fileName)}`,
  });
}
