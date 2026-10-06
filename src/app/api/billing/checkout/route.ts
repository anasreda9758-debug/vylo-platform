import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { plan } from "@/features/billing/schema";
import { getSession } from "@/shared/session";
import { isCurrentlyPurchasablePlan } from "@/features/billing/pricing";

/**
 * Paymob checkout is deliberately disabled. Do not create payment records,
 * payment keys, or outbound gateway calls until the live payment review is
 * explicitly authorized.
 *
 * The legacy "year" plan is rejected explicitly so the guard stays in place
 * when payments are re-enabled.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let planId: string;
  try {
    const body = await request.json();
    if (typeof body.planId !== "string" || body.planId.length === 0) {
      return NextResponse.json({ error: "invalid planId" }, { status: 400 });
    }
    planId = body.planId;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const selectedPlan = await db.query.plan.findFirst({ where: eq(plan.id, planId) });
  if (selectedPlan && !(await isCurrentlyPurchasablePlan(selectedPlan))) {
    return NextResponse.json({ error: "Product not available" }, { status: 400 });
  }

  return NextResponse.json({ error: "payments are not active" }, { status: 503 });
}
