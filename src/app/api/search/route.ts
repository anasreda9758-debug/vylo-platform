import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { getRAGIndex, retrieve } from "@/features/rag";
import { db } from "@/shared/db";
import { lecture } from "@/features/curriculum/schema";
import { inArray } from "drizzle-orm";
import { getAccessibleLecture } from "@/features/access/learning-access";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return NextResponse.json({ error: "missing query parameter 'q'" }, { status: 400 });
  }
  if (q.length > 500) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }

  const moduleSlug = request.nextUrl.searchParams.get("module") ?? undefined;
  const requestedK = parseInt(request.nextUrl.searchParams.get("k") ?? "5", 10);
  const topK = Number.isFinite(requestedK) ? Math.min(Math.max(requestedK, 1), 20) : 5;

  try {
    const index = await getRAGIndex();
    const results = retrieve(index, q, { topK, moduleSlug });
    const lectureIds = [...new Set(results.map((result) => result.chunk.lectureId))];
    const lectures = lectureIds.length
      ? await db.query.lecture.findMany({ where: inArray(lecture.id, lectureIds) })
      : [];
    const available = new Map<string, string>();
    for (const lectureRow of lectures) {
      const access = await getAccessibleLecture(session.user, lectureRow.id, { allowPreview: true });
      if (access.ok) {
        available.set(lectureRow.id, lectureRow.slug);
      }
    }

    return NextResponse.json({
      query: q,
      results: results.filter((result) => available.has(result.chunk.lectureId)).map((r) => ({
        text: r.chunk.text.slice(0, 500),
        lectureTitle: r.chunk.lectureTitle,
        lectureId: r.chunk.lectureId,
        lectureSlug: available.get(r.chunk.lectureId),
        moduleSlug: r.chunk.moduleSlug,
        score: Math.round(r.score * 1000) / 1000,
      })),
    });
  } catch (err) {
    console.error("search error:", err);
    return NextResponse.json({ error: "search unavailable" }, { status: 502 });
  }
}
