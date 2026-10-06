import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * `public/` assets are otherwise served before application code. OSPE reference
 * PDFs and lecture summary cards must always go through authenticated content
 * routes instead.
 */
export function proxy(_request: NextRequest) {
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/ospe-pdfs/:path*", "/study-cards/:path*"],
};
