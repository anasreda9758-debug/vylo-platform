import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { promoCode } from "@/features/billing/schema";
import { curriculumModule } from "@/features/curriculum/schema";
import { academicPeriod } from "@/features/hierarchy/schema";
import { generateRedeemCode, newRedeemCodeId } from "@/features/billing/redeem-codes";
import { getSession } from "@/shared/session";

async function admin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET() {
  const error = await admin();
  if (error) return error;
  const [codes, modules, periods] = await Promise.all([
    db.query.promoCode.findMany({ orderBy: [asc(promoCode.createdAt)] }),
    db.select({ id: curriculumModule.id, name: curriculumModule.name }).from(curriculumModule).orderBy(asc(curriculumModule.order)),
    db.select({ id: academicPeriod.id, academicYear: academicPeriod.academicYear, type: academicPeriod.type }).from(academicPeriod),
  ]);
  return NextResponse.json({ codes, modules, periods });
}

export async function POST(request: NextRequest) {
  const error = await admin();
  if (error) return error;
  const body = await request.json() as Record<string, unknown>;
  const rewardType = ["FREE_MODULE", "FREE_FULL_TERM", "PERCENTAGE_DISCOUNT", "FIXED_EGP_DISCOUNT", "FREE_PURCHASE"].includes(String(body.rewardType))
    ? String(body.rewardType) : null;
  const count = Math.min(500, Math.max(1, Number(body.count ?? 1)));
  if (!rewardType || !Number.isInteger(count)) return NextResponse.json({ error: "Invalid reward or count" }, { status: 400 });
  const maxUses = Number(body.maxUses ?? 1);
  const maxUsesPerUser = Number(body.maxUsesPerUser ?? 1);
  if (!Number.isInteger(maxUses) || maxUses < 1 || !Number.isInteger(maxUsesPerUser) || maxUsesPerUser < 1) {
    return NextResponse.json({ error: "Invalid usage limits" }, { status: 400 });
  }
  const moduleId = typeof body.moduleId === "string" && body.moduleId ? body.moduleId : null;
  const academicPeriodId = typeof body.academicPeriodId === "string" && body.academicPeriodId ? body.academicPeriodId : null;
  if (rewardType === "FREE_MODULE" && !moduleId) return NextResponse.json({ error: "Select a module" }, { status: 400 });
  if (rewardType === "FREE_FULL_TERM" && !academicPeriodId) return NextResponse.json({ error: "Select an academic period" }, { status: 400 });
  const discountType = rewardType === "PERCENTAGE_DISCOUNT" ? "PERCENTAGE" : "FIXED_EGP";
  const discountValue = rewardType === "PERCENTAGE_DISCOUNT" ? Number(body.rewardValue ?? 0) : Number(body.rewardValue ?? 0);
  const codes = Array.from({ length: count }, () => ({
    id: newRedeemCodeId(),
    code: generateRedeemCode(),
    internalLabel: typeof body.internalLabel === "string" ? body.internalLabel.trim() || null : null,
    description: typeof body.internalLabel === "string" ? body.internalLabel.trim() || null : null,
    rewardType,
    discountType,
    discountValue: Number.isInteger(discountValue) && discountValue >= 0 ? discountValue : 0,
    appliesTo: rewardType === "FREE_FULL_TERM" ? "FULL_TERM" : rewardType === "FREE_MODULE" ? "MODULE" : "ANY",
    moduleId,
    academicPeriodId,
    active: true,
    startsAt: null,
    expiresAt: null,
    maxUses,
    usedCount: 0,
    maxUsesPerUser,
  }));
  const created = await db.insert(promoCode).values(codes).returning({ code: promoCode.code, id: promoCode.id });
  return NextResponse.json({ codes: created }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const error = await admin();
  if (error) return error;
  const body = await request.json() as { id?: unknown; active?: unknown };
  if (typeof body.id !== "string" || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Invalid code status update" }, { status: 400 });
  }
  const [updated] = await db.update(promoCode)
    .set({ active: body.active, updatedAt: new Date() })
    .where(eq(promoCode.id, body.id))
    .returning({ id: promoCode.id, active: promoCode.active });
  if (!updated) return NextResponse.json({ error: "Code not found" }, { status: 404 });
  return NextResponse.json({ code: updated });
}
