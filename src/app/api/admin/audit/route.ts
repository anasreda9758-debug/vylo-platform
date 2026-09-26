import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { getAuditLogs } from "@/features/hierarchy/audit";
import { getAuditRows, getAuditSummary, resolveRange, parseRangeKey } from "@/features/admin/analytics";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = request.nextUrl;
  const hasFilters = ["action", "entityType", "search", "from", "to"].some((k) => url.searchParams.has(k));
  const page = Number(url.searchParams.get("page")) || 1;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  // Backward-compatible simple path (no filters) for the existing admin tab.
  if (!hasFilters) {
    const logs = await getAuditLogs({ limit });
    return NextResponse.json({ logs });
  }

  const rangeKey = parseRangeKey(url.searchParams.get("range"));
  const range = await resolveRange(rangeKey, {
    from: rangeKey === "custom" ? url.searchParams.get("from") : null,
    to: rangeKey === "custom" ? url.searchParams.get("to") : null,
  });

  const rows = await getAuditRows({
    action: url.searchParams.get("action"),
    entityType: url.searchParams.get("entityType"),
    search: url.searchParams.get("search"),
    range,
    page,
    limit,
  });

  const summary = await getAuditSummary();

  return NextResponse.json({ ...rows, summary, range: range.label });
}