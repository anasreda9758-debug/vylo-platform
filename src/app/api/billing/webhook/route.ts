import { NextResponse } from "next/server";

/**
 * Live payment processing is intentionally disabled. In particular, this
 * endpoint must not verify a Paymob callback or grant a subscription until a
 * separately authorized payment implementation is ready for production.
 */
export async function POST() {
  return NextResponse.json({ error: "payments are not active" }, { status: 503 });
}
