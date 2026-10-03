import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/shared/db";
import { curriculumModule } from "@/features/curriculum/schema";
import { academicPeriod } from "./schema";
import { buildAcademicVisibility, isAcademicModuleVisible, filterAcademicModules, type AcademicWindow, type PeriodModule } from "./academic-visibility";
import { plan } from "@/features/billing/schema";

// Request-local only. No TTL/cache can outlive a start/end boundary or an admin edit.
export const getAcademicPeriods = cache(async (): Promise<AcademicWindow[]> => db.select({
  id: academicPeriod.id, academicYear: academicPeriod.academicYear, type: academicPeriod.type,
  startsAt: sql<string>`${academicPeriod.startsAt}::text`,
  endsAt: sql<string>`${academicPeriod.endsAt}::text`, active: academicPeriod.active,
}).from(academicPeriod));

export const getAcademicVisibility = cache(async () => buildAcademicVisibility(await getAcademicPeriods(), new Date()));

export async function isModuleAcademicallyVisible(
  actor: { role?: string | null } | null | undefined,
  module: PeriodModule & { id: string },
) {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  // Some result/analytics guards carry only module ID. Resolve its actual year/association,
  // never its term number, slug, client query or entitlement.
  const row = module.academicPeriodId === undefined || module.studyYear === undefined
    ? await db.query.curriculumModule.findFirst({ where: eq(curriculumModule.id, module.id), columns: { academicPeriodId: true, studyYear: true } })
    : module;
  return Boolean(row && isAcademicModuleVisible(row, await getAcademicVisibility(), actor.role));
}

/** Discovery guard only: prices, discounts, entitlements and plan records stay unchanged. */
export async function isPlanAcademicallyVisible(planId: string, role?: string | null) {
  if (role === "admin") return true;
  const selected = await db.query.plan.findFirst({ where: eq(plan.id, planId), columns: { scope: true, scopeRef: true } });
  if (!selected?.scopeRef || !["module", "term"].includes(selected.scope)) return false;
  const term = Number(selected.scopeRef);
  if (selected.scope === "term" && (!Number.isInteger(term) || term < 1)) return false;
  const modules = await db.query.curriculumModule.findMany({
    where: selected.scope === "module" ? eq(curriculumModule.slug, selected.scopeRef) : eq(curriculumModule.term, term),
    columns: { academicPeriodId: true, studyYear: true },
  });
  return filterAcademicModules(modules, await getAcademicVisibility(), role).length > 0;
}

export async function isSummerAcademicallyVisible(role?: string | null) {
  if (role === "admin") return true;
  const visibility = await getAcademicVisibility();
  return visibility.periods.some((period) => period.type === "SUMMER" && visibility.currentPeriodIds.has(period.id));
}
