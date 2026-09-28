import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { curriculumModule, lecture } from "@/features/curriculum/schema";
import { logAudit } from "@/features/hierarchy/audit";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

// GET — list all modules with lecture counts
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await db.execute(sql`
    SELECT m.id, m.name, m.slug, m.description, m."order", m.is_free, m.study_year, m.term,
      m.subject_id, m.created_at, m.updated_at,
      (SELECT count(*) FROM lecture l WHERE l.module_id = m.id) as lecture_count
    FROM module m
    ORDER BY m."order", m.name
  `);

  const modules = (rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    order: r.order,
    isFree: r.is_free,
    studyYear: Number(r.study_year ?? 1),
    term: r.term,
    subjectId: r.subject_id,
    lectureCount: Number(r.lecture_count),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ modules });
}

// POST — create module
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  // Check slug uniqueness
  const [existing] = await db.execute(sql`SELECT id FROM module WHERE slug = ${slug}`);
  if (existing) {
    return NextResponse.json({ error: "slug already exists" }, { status: 400 });
  }

  const id = randomUUID();
  const maxOrder = await db.execute(sql`SELECT COALESCE(MAX("order"), 0) + 1 as next_order FROM module`);
  const nextOrder = (maxOrder as any[])[0]?.next_order ?? 1;

  await db.insert(curriculumModule).values({
    id,
    name: body.name,
    slug,
    description: body.description ?? null,
    subjectId: body.subjectId ?? null,
    order: body.order ?? nextOrder,
    isFree: body.isFree ?? false,
    studyYear: Number(body.studyYear) || 1,
    term: body.term ?? 1,
  });

  await logAudit({
    userId: admin.user.id,
    userName: admin.user.name,
    action: "create",
    entityType: "module",
    entityId: id,
    entityName: body.name,
    newData: { name: body.name, slug, studyYear: Number(body.studyYear) || 1, term: body.term ?? 1 },
  });

  revalidatePath("/admin");
  revalidatePath("/curriculum");
  return NextResponse.json({ id, slug });
}

// PUT — update module
export async function PUT(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [existing] = await db.execute(sql`SELECT * FROM module WHERE id = ${body.id}`);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updates: Partial<typeof curriculumModule.$inferInsert> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "invalid name" }, { status: 400 });
    updates.name = body.name;
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== "string" || !body.slug.trim()) return NextResponse.json({ error: "invalid slug" }, { status: 400 });
    updates.slug = body.slug;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") return NextResponse.json({ error: "invalid description" }, { status: 400 });
    updates.description = body.description;
  }
  if (body.subjectId !== undefined) {
    if (body.subjectId !== null && typeof body.subjectId !== "string") return NextResponse.json({ error: "invalid subjectId" }, { status: 400 });
    updates.subjectId = body.subjectId;
  }
  if (body.order !== undefined) {
    if (!Number.isInteger(body.order)) return NextResponse.json({ error: "invalid order" }, { status: 400 });
    updates.order = body.order;
  }
  if (body.isFree !== undefined) {
    if (typeof body.isFree !== "boolean") return NextResponse.json({ error: "invalid isFree" }, { status: 400 });
    updates.isFree = body.isFree;
  }
  if (body.studyYear !== undefined) {
    if (!Number.isInteger(Number(body.studyYear)) || Number(body.studyYear) < 1) return NextResponse.json({ error: "invalid studyYear" }, { status: 400 });
    updates.studyYear = Number(body.studyYear);
  }
  if (body.term !== undefined) {
    if (!Number.isInteger(body.term)) return NextResponse.json({ error: "invalid term" }, { status: 400 });
    updates.term = body.term;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  await db.update(curriculumModule).set(updates).where(eq(curriculumModule.id, body.id));

  await logAudit({
    userId: admin.user.id,
    userName: admin.user.name,
    action: "update",
    entityType: "module",
    entityId: body.id,
    entityName: body.name ?? (existing as any).name,
    oldData: { name: (existing as any).name, slug: (existing as any).slug },
    newData: updates,
  });

  revalidatePath("/admin");
  revalidatePath("/curriculum");
  return NextResponse.json({ ok: true });
}

// DELETE — delete module
export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [existing] = await db.execute(sql`SELECT name FROM module WHERE id = ${id}`);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.execute(sql`DELETE FROM module WHERE id = ${id}`);

  await logAudit({
    userId: admin.user.id,
    userName: admin.user.name,
    action: "delete",
    entityType: "module",
    entityId: id,
    entityName: (existing as any).name,
  });

  revalidatePath("/admin");
  revalidatePath("/curriculum");
  return NextResponse.json({ ok: true });
}
