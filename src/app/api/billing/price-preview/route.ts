import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { isPlanAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";
import {
  calculatePricePreview,
  PromoValidationError,
} from "@/features/billing/pricing";

export async function POST(request: NextRequest) {
  const session = await getSession();
  let body: { planId?: unknown; promoCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.planId !== "string" || body.planId.length === 0) {
    return NextResponse.json({ error: "invalid planId" }, { status: 400 });
  }
  try {
    if (!(await isPlanAcademicallyVisible(body.planId, session?.user.role))) {
      return NextResponse.json({ error: "Product not available" }, { status: 404 });
    }
    return NextResponse.json(await calculatePricePreview({
      planId: body.planId,
      promoCodeText: typeof body.promoCode === "string" ? body.promoCode : undefined,
      userId: session?.user.id,
    }));
  } catch (error) {
    if (error instanceof PromoValidationError) {
      const messages: Record<string, string> = {
        INVALID_CODE: "Invalid code",
        CODE_EXPIRED: "Code expired",
        CODE_NOT_ACTIVE: "Code not active",
        CODE_USAGE_LIMIT: "Code usage limit reached",
        ALREADY_USED: "Already used by this account",
        CODE_NOT_VALID_FOR_PRODUCT: "Code not valid for this product/module",
      };
      return NextResponse.json({ error: messages[error.code] }, { status: 400 });
    }
    if (error instanceof Error && error.message === "PLAN_NOT_FOUND") {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    if (error instanceof Error && (error.message === "PRODUCT_NOT_AVAILABLE" || error.message === "ACADEMIC_PERIOD_NOT_CONFIGURED")) {
      return NextResponse.json({ error: "Product not available" }, { status: 400 });
    }
    console.error("[billing/price-preview]", error);
    return NextResponse.json({ error: "Unable to calculate price" }, { status: 500 });
  }
}
