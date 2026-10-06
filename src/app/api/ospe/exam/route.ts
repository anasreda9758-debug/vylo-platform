import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { createExam, startExam } from "@/features/ospe/exam";
import { studentExam } from "@/features/ospe/integrity";
import {
  getAccessibleOspeFolder,
  getAccessibleOspeFolders,
  getAccessibleOspeExam,
} from "@/features/access/learning-access";
import { resolvePracticalOspeScope } from "@/features/practical/ospe-scope";

/**
 * POST /api/ospe/exam
 * Create and start an exam session.
 * Body: { folder?: string, stationCount?: number, timePerStationSec?: number, totalTimeLimitSec?: number }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    folder?: string;
    moduleSlug?: string;
    subjectSlug?: string;
    stationCount?: number;
    timePerStationSec?: number;
    totalTimeLimitSec?: number;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.folder !== undefined && (typeof body.folder !== "string" || body.folder.length === 0)) {
    return NextResponse.json({ error: "invalid OSPE folder" }, { status: 400 });
  }
  const hasPracticalScope = body.moduleSlug !== undefined || body.subjectSlug !== undefined;
  if (hasPracticalScope && (typeof body.moduleSlug !== "string" || !body.moduleSlug || typeof body.subjectSlug !== "string" || !body.subjectSlug || body.folder)) {
    return NextResponse.json({ error: "invalid practical OSPE scope" }, { status: 400 });
  }

  const stationCount = Math.min(Math.max(body.stationCount ?? 10, 1), 30);
  const timePerStationSec = Math.min(Math.max(body.timePerStationSec ?? 60, 15), 300);
  const totalTimeLimitSec = Math.min(Math.max(body.totalTimeLimitSec ?? stationCount * timePerStationSec, 60), 3600);

  let permittedFolders: string[] | undefined;
  let practicalTrackId: string | undefined;
  if (hasPracticalScope) {
    const track = await resolvePracticalOspeScope(session.user, body.moduleSlug!, body.subjectSlug!);
    if (!track.ok) return NextResponse.json({ error: "OSPE content not available" }, { status: track.reason === "forbidden" ? 403 : track.reason === "unauthenticated" ? 401 : 404 });
    practicalTrackId = track.value.id;
  } else if (body.folder) {
    const folderAccess = await getAccessibleOspeFolder(session.user, body.folder);
    if (!folderAccess.ok) return NextResponse.json({ error: "OSPE content not available" }, { status: 403 });
    permittedFolders = [folderAccess.value.folder];
  } else {
    const foldersAccess = await getAccessibleOspeFolders(session.user);
    if (!foldersAccess.ok) return NextResponse.json({ error: "OSPE content not available" }, { status: 403 });
    permittedFolders = foldersAccess.value.map((item) => item.folder);
  }
  if (permittedFolders && permittedFolders.length === 0) {
    return NextResponse.json({ error: "OSPE content not available" }, { status: 403 });
  }

  try {
    const examId = await createExam({
      userId: session.user.id,
      practicalTrackId,
      folder: body.folder,
      stationCount,
      timePerStationSec,
      totalTimeLimitSec,
    });

    await startExam(examId, permittedFolders);

    // Fetch only an exam whose stations remain inside the user's access scope.
    const fullExamAccess = await getAccessibleOspeExam(session.user, examId);
    if (!fullExamAccess.ok) {
      return NextResponse.json({ error: "exam created but could not be loaded" }, { status: 500 });
    }
    const fullExam = fullExamAccess.value;

    return NextResponse.json({ ok: true, ...studentExam(fullExam) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create exam" },
      { status: 400 },
    );
  }
}
