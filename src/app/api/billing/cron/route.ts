import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processExpiredSubscriptions } from "@/features/billing/queries";

function bearerMatches(authHeader: string | null, secret: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authHeader.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * GET /api/billing/cron
 * Run daily (via Vercel Cron or external cron job) to:
 *   1. Move expired active subscriptions to grace period
 *   2. Fully expire grace-period subscriptions past their deadline
 *
 * Protect with CRON_SECRET header.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await processExpiredSubscriptions();
  return NextResponse.json({ ok: true, ...result });
}
