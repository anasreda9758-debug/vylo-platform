import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { streamFile } from "@/shared/storage";
import { getAccessibleLecture } from "@/features/access/learning-access";

export const dynamic = "force-dynamic";

const privatePdfHeaders = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Vary": "Cookie, Authorization",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lectureId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: privatePdfHeaders });
  }

  const { lectureId } = await params;
  const access = await getAccessibleLecture(session.user, lectureId, { allowPreview: true });
  // A direct ID must not reveal whether a protected lecture/PDF exists.
  if (!access.ok) return NextResponse.json({ error: "not found" }, { status: 404, headers: privatePdfHeaders });
  const row = access.value;

  if (!row.pdfFile) {
    return NextResponse.json({ error: "no pdf on file for this lecture" }, { status: 404, headers: privatePdfHeaders });
  }

  const response = await streamFile(row.pdfFile);
  if (!response) {
    return NextResponse.json({ error: "file not found" }, { status: 404, headers: privatePdfHeaders });
  }

  // Storage/CDN defaults must never turn an authorized response into a public one.
  for (const [name, value] of Object.entries(privatePdfHeaders)) response.headers.set(name, value);
  return response;
}
