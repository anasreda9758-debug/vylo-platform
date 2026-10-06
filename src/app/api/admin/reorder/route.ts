import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { curriculumModule, lecture } from "@/features/curriculum/schema";
import { logAudit } from "@/features/hierarchy/audit";

// POST — reorder items (modules or lectures)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { entityType } = body as { entityType: string; items?: unknown };

  if (entityType !== "module" && entityType !== "lecture") {
    return NextResponse.json({ error: "invalid entityType" }, { status: 400 });
  }

  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "entityType and items required" }, { status: 400 });
  }

  const typedItems: { id: string; order: number }[] = [];
  for (const item of items) {
    const candidate = item as { id?: unknown; order?: unknown };
    if (
      typeof candidate.id !== "string" ||
      !candidate.id.trim() ||
      typeof candidate.order !== "number" ||
      !Number.isInteger(candidate.order)
    ) {
      return NextResponse.json({ error: "invalid item" }, { status: 400 });
    }
    typedItems.push({ id: candidate.id, order: candidate.order });
  }

  for (const item of typedItems) {
    if (entityType === "module") {
      await db.update(curriculumModule).set({ order: item.order }).where(eq(curriculumModule.id, item.id));
    } else {
      await db.update(lecture).set({ order: item.order }).where(eq(lecture.id, item.id));
    }
  }

  await logAudit({
    userId: session.user.id,
    userName: session.user.name,
    action: "reorder",
    entityType,
    entityName: `${items.length} items`,
    newData: { order: items.map((i) => ({ id: i.id, order: i.order })) },
  });

  revalidatePath("/admin");
  revalidatePath("/curriculum");
  return NextResponse.json({ ok: true });
}
