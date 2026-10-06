import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { calculateSummerPreview } from "@/features/billing/summer-pricing";
import { PromoValidationError } from "@/features/billing/pricing";
import { isModuleAcademicallyVisible, isSummerAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";

export async function POST(request: NextRequest) {
  const session = await getSession();
  let body: { moduleIds?: unknown; promoCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.moduleIds) || body.moduleIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "invalid moduleIds" }, { status: 400 });
  }
  try {
    if (!(await isSummerAcademicallyVisible(session?.user.role))) {
      return NextResponse.json({ error: "Summer retakes are not currently available" }, { status: 404 });
    }
    for (const id of body.moduleIds as string[]) {
      if (!(await isModuleAcademicallyVisible(session?.user ?? { role: "student" }, { id }))) {
        return NextResponse.json({ error: "Product not available" }, { status: 404 });
      }
    }
    return NextResponse.json(await calculateSummerPreview({
      moduleIds: body.moduleIds,
      promoCodeText: typeof body.promoCode === "string" ? body.promoCode : undefined,
      userId: session?.user.id,
    }));
  } catch (error) {
    if (error instanceof PromoValidationError) {
      const messages: Record<string, string> = {
        INVALID_CODE: "Invalid code",
        CODE_EXPIRED: "Code expired",
        CODE_NOT_ACTIVE: "Code not active",
        CODE_NOT_VALID_FOR_PRODUCT: "Code not valid for Summer retakes",
        CODE_USAGE_LIMIT: "Code usage limit reached",
        ALREADY_USED: "Already used by this account",
      };
      return NextResponse.json({ error: messages[error.code] }, { status: 400 });
    }
    const messages: Record<string, string> = {
      SUMMER_NOT_ACTIVE: "Summer retakes are not currently available",
      NO_SUMMER_MODULES_SELECTED: "Select at least one module",
      INVALID_SUMMER_MODULE: "One or more selected modules are invalid",
      MODULE_NOT_PUBLISHED: "One or more selected modules are not available",
      SUMMER_ACCESS_ALREADY_ACTIVE: "You already have active Summer access for one or more selected modules",
    };
    if (error instanceof Error && messages[error.message]) {
      return NextResponse.json({ error: messages[error.message] }, { status: 400 });
    }
    console.error("[billing/summer-preview]", error);
    return NextResponse.json({ error: "Unable to calculate Summer price" }, { status: 500 });
  }
}
