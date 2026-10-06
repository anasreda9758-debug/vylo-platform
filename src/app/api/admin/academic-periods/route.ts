import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { academicPeriod } from "@/features/hierarchy/schema";
import { curriculumModule } from "@/features/curriculum/schema";
import { getAcademicPeriods } from "@/features/hierarchy/academic-visibility-server";
import { academicConfigurationWarnings, ACADEMIC_TIME_ZONE, academicTimestampForStorage } from "@/features/hierarchy/academic-visibility";
import { getSession } from "@/shared/session";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET() {
  const error = await requireAdmin();
  if (error) return error;
  const periods = await getAcademicPeriods();
  const modules = await db.select({ academicPeriodId: curriculumModule.academicPeriodId }).from(curriculumModule);
  return NextResponse.json({ periods, timeZone: ACADEMIC_TIME_ZONE, warnings: academicConfigurationWarnings(periods, modules) });
}

export async function PATCH(request: NextRequest) {
  const error = await requireAdmin();
  if (error) return error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.id !== "string" || typeof body.startsAt !== "string" || typeof body.endsAt !== "string") {
    return NextResponse.json({ error: "id, startsAt, and endsAt are required" }, { status: 400 });
  }
  // datetime-local means Cairo, not whichever timezone the admin browser/host uses.
  const startsAt = academicTimestampForStorage(body.startsAt);
  const endsAt = academicTimestampForStorage(body.endsAt);
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: "Use Cairo local date/time or an explicit timestamp offset" }, { status: 400 });
  }
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return NextResponse.json({ error: "Invalid academic period dates" }, { status: 400 });
  }
  const [updated] = await db.update(academicPeriod)
    .set({ startsAt, endsAt, active: body.active !== false, updatedAt: new Date() })
    .where(eq(academicPeriod.id, body.id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Academic period not found" }, { status: 404 });
  return NextResponse.json({ period: updated });
}
