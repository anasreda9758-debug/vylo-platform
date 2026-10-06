import { and, eq } from "drizzle-orm";
import { extname } from "node:path";
import { stat } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/shared/db";
import { getSession } from "@/shared/session";
import { resolvePracticalOspeScope } from "@/features/practical/ospe-scope";
import { ospeAnswerKey, practicalTrackOspeStation } from "@/features/ospe/schema";
import { OSPE_IMAGE_MIME, resolveOspeImage } from "@/features/ospe/data";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const moduleSlug = request.nextUrl.searchParams.get("module") ?? "";
  const subjectSlug = request.nextUrl.searchParams.get("subject") ?? "";
  const folder = request.nextUrl.searchParams.get("folder") ?? "";
  const fileName = request.nextUrl.searchParams.get("file") ?? "";
  if (!moduleSlug || !subjectSlug || !folder || !fileName) return NextResponse.json({ error: "missing params" }, { status: 400 });

  const resolution = await resolvePracticalOspeScope(session.user, moduleSlug, subjectSlug);
  if (!resolution.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [association] = await db.select({ answerKeyId: ospeAnswerKey.id }).from(practicalTrackOspeStation)
    .innerJoin(ospeAnswerKey, eq(practicalTrackOspeStation.answerKeyId, ospeAnswerKey.id))
    .where(and(
      eq(practicalTrackOspeStation.trackId, resolution.value.id),
      eq(ospeAnswerKey.folder, folder),
      eq(ospeAnswerKey.fileName, fileName),
    )).limit(1);
  if (!association) return NextResponse.json({ error: "not found" }, { status: 404 });

  const resolved = resolveOspeImage(folder, fileName);
  if (!resolved) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { createReadStream } = await import("node:fs");
    const stream = createReadStream(resolved);
    const body = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (error) => controller.error(error));
      },
      cancel() { stream.destroy(); },
    });
    return new NextResponse(body, { headers: {
      "Content-Type": OSPE_IMAGE_MIME[extname(fileName).toLowerCase()] ?? "image/jpeg",
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
