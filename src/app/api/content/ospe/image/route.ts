import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { getOspeModuleAccess } from "@/features/ospe/queries";
import { OSPE_IMAGE_MIME, resolveOspeImage } from "@/features/ospe/data";
import { ospeAnswerKey } from "@/features/ospe/schema";
import { db } from "@/shared/db";
import { extname } from "node:path";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const folder = request.nextUrl.searchParams.get("folder") ?? "";
  const fileName = request.nextUrl.searchParams.get("file") ?? "";
  if (!folder || !fileName) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  const access = await getOspeModuleAccess(session.user);
  const meta = access.find((a) => a.folder === folder);
  if (!meta) {
    return NextResponse.json({ error: "unknown folder" }, { status: 404 });
  }
  if (meta.locked) {
    return NextResponse.json({ error: "premium required" }, { status: 403 });
  }

  // Only explicitly reviewed station images are ever served. The (folder,
  // fileName) pair must exist on the reviewed answer key, so answer-key-labeled
  // or unapproved derivatives can never be fetched by filename.
  const [station] = await db
    .select({ id: ospeAnswerKey.id })
    .from(ospeAnswerKey)
    .where(and(eq(ospeAnswerKey.folder, folder), eq(ospeAnswerKey.fileName, fileName)))
    .limit(1);
  if (!station) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const resolved = resolveOspeImage(folder, fileName);
  if (!resolved) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const mime = OSPE_IMAGE_MIME[extname(fileName).toLowerCase()] ?? "image/jpeg";
  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return streamImage(resolved, info.size, mime);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

async function streamImage(resolved: string, contentLength: number, mime: string) {
  const { createReadStream } = await import("node:fs");
  const stream = createReadStream(resolved);
  const body = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(contentLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
