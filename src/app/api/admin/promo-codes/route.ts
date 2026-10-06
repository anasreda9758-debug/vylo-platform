import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import { curriculumModule } from "@/features/curriculum/schema";
import { academicPeriod } from "@/features/hierarchy/schema";
import { promoCode, promoRedemption } from "@/features/billing/schema";
import { getSession } from "@/shared/session";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { session };
}

function parseDate(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function validateInput(body: Record<string, unknown>) {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const discountType = body.discountType === "PERCENTAGE" || body.discountType === "FIXED_EGP" ? body.discountType : null;
  const appliesTo = body.appliesTo === "ANY" || body.appliesTo === "MODULE" || body.appliesTo === "FULL_TERM" ? body.appliesTo : null;
  const discountValue = Number(body.discountValue);
  const maxUses = body.maxUses === "" || body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses);
  const maxUsesPerUser = body.maxUsesPerUser === "" || body.maxUsesPerUser === null || body.maxUsesPerUser === undefined ? 1 : Number(body.maxUsesPerUser);
  if (!code || !discountType || !appliesTo || !Number.isInteger(discountValue) || discountValue < 0) return { error: "Invalid promo code fields" };
  if (discountType === "PERCENTAGE" && discountValue > 100) return { error: "Percentage must be between 0 and 100" };
  if (appliesTo !== "MODULE" && body.moduleId) return { error: "moduleId is only valid for module codes" };
  if (!Number.isInteger(maxUsesPerUser) || maxUsesPerUser < 1) return { error: "Invalid per-user limit" };
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return { error: "Invalid total usage limit" };
  const startsAt = parseDate(body.startsAt);
  const expiresAt = parseDate(body.expiresAt);
  if (startsAt === undefined || expiresAt === undefined) return { error: "Invalid date" };
  return {
    value: {
      code,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      discountType,
      discountValue,
      appliesTo,
      moduleId: appliesTo === "MODULE" && typeof body.moduleId === "string" ? body.moduleId : null,
      academicPeriodId: typeof body.academicPeriodId === "string" ? body.academicPeriodId : null,
      active: body.active !== false,
      startsAt,
      expiresAt,
      maxUses,
      maxUsesPerUser,
    },
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const codes = await db.query.promoCode.findMany({
    orderBy: [asc(promoCode.code)],
    with: { module: true },
  });
  const redemptionCounts = await db
    .select({ promoCodeId: promoRedemption.promoCodeId, count: sql<number>`count(*)::int` })
    .from(promoRedemption)
    .groupBy(promoRedemption.promoCodeId);
  const counts = new Map(redemptionCounts.map((row) => [row.promoCodeId, row.count]));
  const modules = await db.select({ id: curriculumModule.id, name: curriculumModule.name }).from(curriculumModule).orderBy(asc(curriculumModule.order));
  const periods = await db.select({ id: academicPeriod.id, academicYear: academicPeriod.academicYear, type: academicPeriod.type }).from(academicPeriod).orderBy(asc(academicPeriod.academicYear), asc(academicPeriod.type));
  return NextResponse.json({ codes: codes.map((code) => ({ ...code, redemptionCount: counts.get(code.id) ?? 0 })), modules, periods });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = validateInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const [created] = await db.insert(promoCode).values({ id: randomUUID(), ...parsed.value }).returning();
    return NextResponse.json({ code: created }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "Code already exists" }, { status: 409 });
    console.error("[admin/promo-codes]", error);
    return NextResponse.json({ error: "Unable to create code" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.id !== "string") return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const parsed = validateInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const [updated] = await db.update(promoCode).set({ ...parsed.value, updatedAt: new Date() }).where(eq(promoCode.id, body.id)).returning();
  if (!updated) return NextResponse.json({ error: "Code not found" }, { status: 404 });
  return NextResponse.json({ code: updated });
}
