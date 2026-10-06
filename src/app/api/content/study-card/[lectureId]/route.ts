import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { getAccessibleLecture } from "@/features/access/learning-access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lectureId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { lectureId } = await params;
  const access = await getAccessibleLecture(session.user, lectureId, { allowPreview: true });
  if (!access.ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  const path = join(process.cwd(), "public", "study-cards", `${access.value.slug}.svg`);
  try {
    const info = await stat(path);
    if (!info.isFile()) return NextResponse.json({ error: "not found" }, { status: 404 });
    return streamSvg(path, info.size);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

function streamSvg(path: string, contentLength: number) {
  const stream = createReadStream(path);
  const body = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
    },
  });
}
