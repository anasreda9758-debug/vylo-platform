import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { lectureNote } from "@/features/curriculum/schema";
import { getAccessibleLecture } from "@/features/access/learning-access";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Sign in required" }, { status: 401 });
  const lectureId = new URL(request.url).searchParams.get("lectureId");
  if (!lectureId) {
    return NextResponse.json({ message: "Lecture not available" }, { status: 403 });
  }
  const access = await getAccessibleLecture(session.user, lectureId, { allowPreview: true });
  if (!access.ok) {
    return NextResponse.json({ message: "Lecture not available" }, { status: 403 });
  }
  const notes = await db.query.lectureNote.findMany({
    where: and(eq(lectureNote.userId, session.user.id), eq(lectureNote.lectureId, lectureId)),
    orderBy: [desc(lectureNote.updatedAt)],
  });
  return NextResponse.json({ notes });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const lectureId = typeof body?.lectureId === "string" ? body.lectureId : "";
  const note = typeof body?.body === "string" ? body.body.trim() : "";
  const highlightedText = typeof body?.highlightedText === "string" ? body.highlightedText.trim() : "";
  if (!lectureId || !note || note.length > 4000 || highlightedText.length > 500) {
    return NextResponse.json({ message: "Invalid note" }, { status: 400 });
  }
  const access = await getAccessibleLecture(session.user, lectureId, { allowPreview: true });
  if (!access.ok) {
    return NextResponse.json({ message: "Lecture not available" }, { status: 403 });
  }
  const [created] = await db.insert(lectureNote).values({
    id: randomUUID(),
    userId: session.user.id,
    lectureId,
    body: note,
    highlightedText: highlightedText || null,
  }).returning();
  return NextResponse.json({ note: created }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Sign in required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ message: "Note id required" }, { status: 400 });
  await db.delete(lectureNote).where(and(eq(lectureNote.id, id), eq(lectureNote.userId, session.user.id)));
  return NextResponse.json({ ok: true });
}
