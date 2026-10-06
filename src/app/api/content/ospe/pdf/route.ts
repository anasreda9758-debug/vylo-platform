import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { getAccessibleOspeFolder } from "@/features/access/learning-access";
import { getOspePdfReference } from "@/features/ospe/data";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const file = request.nextUrl.searchParams.get("file") ?? "";
  const reference = getOspePdfReference(file);
  if (!reference) return NextResponse.json({ error: "not found" }, { status: 404 });

  const access = await getAccessibleOspeFolder(session.user, reference.folder);
  // Do not confirm that a protected reference exists to an unentitled user.
  if (!access.ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  const path = join(process.cwd(), "public", "ospe-pdfs", reference.file);
  try {
    const info = await stat(path);
    if (!info.isFile()) return NextResponse.json({ error: "not found" }, { status: 404 });
    return streamPdf(path, info.size);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

function streamPdf(path: string, contentLength: number) {
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
      "Content-Type": "application/pdf",
      "Content-Length": String(contentLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    },
  });
}
