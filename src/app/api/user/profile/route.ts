import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { user } from "@/features/auth/schema";
import { eq } from "drizzle-orm";

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let name: unknown;
  try {
    const body = await request.json();
    name = body?.name;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }

  await db.update(user).set({ name: name.trim() }).where(eq(user.id, session.user.id));

  return NextResponse.json({ ok: true });
}
