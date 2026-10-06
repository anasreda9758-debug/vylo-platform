import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/shared/session";
import { activateSubscription, deactivateSubscription } from "@/features/billing/queries";
import { getSubscriptionTable, getPlansAdmin } from "@/features/admin/analytics";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = request.nextUrl;
  const [table, plans] = await Promise.all([
    getSubscriptionTable({
      status: url.searchParams.get("status"),
      search: url.searchParams.get("search"),
      page: Number(url.searchParams.get("page")) || 1,
      limit: Number(url.searchParams.get("limit")) || 25,
    }),
    getPlansAdmin(),
  ]);

  return NextResponse.json({ ...table, plans });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let action: "activate" | "deactivate";
  let userId: string;
  let planId: string | null = null;
  try {
    const body = await request.json();
    if (body.action !== "activate" && body.action !== "deactivate") {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return NextResponse.json({ error: "invalid userId" }, { status: 400 });
    }
    action = body.action;
    userId = body.userId;
    if (action === "activate") {
      if (typeof body.planId !== "string" || body.planId.length === 0) {
        return NextResponse.json({ error: "invalid planId" }, { status: 400 });
      }
      planId = body.planId;
    }
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (action === "activate") {
    const activated = await activateSubscription(userId, planId!);
    if (!activated) {
      return NextResponse.json({ error: "plan or period not found" }, { status: 400 });
    }
  } else {
    await deactivateSubscription(userId);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/curriculum");
  return NextResponse.json({ ok: true });
}
