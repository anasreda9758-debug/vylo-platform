import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/shared/db";
import { academicPeriod } from "../src/features/hierarchy/schema";
import { curriculumModule } from "../src/features/curriculum/schema";

const academicYear = process.env.VYLO_ACADEMIC_YEAR ?? "2026-2027";
const periods = [
  { id: `period-${academicYear}-term-1`, type: "TERM_1", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2027-02-28T23:59:59.999Z" },
  { id: `period-${academicYear}-term-2`, type: "TERM_2", startsAt: "2027-03-01T00:00:00.000Z", endsAt: "2027-07-31T23:59:59.999Z" },
  { id: `period-${academicYear}-summer`, type: "SUMMER", startsAt: "2027-07-01T00:00:00.000Z", endsAt: "2027-09-15T23:59:59.999Z" },
] as const;

async function main() {
  for (const period of periods) {
    const existing = await db.query.academicPeriod.findFirst({ where: eq(academicPeriod.id, period.id) });
    const values = { ...period, academicYear, active: true, startsAt: new Date(period.startsAt), endsAt: new Date(period.endsAt), updatedAt: new Date() };
    if (existing) await db.update(academicPeriod).set(values).where(eq(academicPeriod.id, period.id));
    else await db.insert(academicPeriod).values(values);
  }

  const term1 = periods[0].id;
  const term2 = periods[1].id;
  await db.update(curriculumModule).set({ academicPeriodId: term1 }).where(eq(curriculumModule.term, 1));
  await db.update(curriculumModule).set({ academicPeriodId: term2 }).where(eq(curriculumModule.term, 2));
  console.log(`[seed-academic-periods] configured ${academicYear} periods and associated modules by term`);
}

main().catch((error) => {
  console.error("[seed-academic-periods] error:", error);
  process.exitCode = 1;
});
