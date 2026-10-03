/** academic_period uses timestamp WITHOUT time zone: values are Cairo wall time. */
export const ACADEMIC_TIME_ZONE = "Africa/Cairo";

export type AcademicWindow = {
  id: string;
  academicYear: string;
  type: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};
export type PeriodModule = { academicPeriodId?: string | null };
export type AcademicVisibility = {
  periods: AcademicWindow[];
  visiblePeriodIds: Set<string>;
  currentPeriodIds: Set<string>;
};

/** No host/browser timezone parsing of timestamp-without-timezone DB values. */
export function normalizeAcademicTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value);
  if (!match) return null;
  const normalized = `${match[1]}T${match[2]}:${match[3] ?? "00"}.${(match[4] ?? "").padEnd(3, "0").slice(0, 3)}`;
  const date = new Date(`${normalized}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, -1) === normalized ? normalized : null;
}

export function academicNow(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ACADEMIC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${String(now.getUTCMilliseconds()).padStart(3, "0")}`;
}

/** Admin/API inputs are Cairo wall time, or explicit instants converted to Cairo. */
export function academicTimestampForStorage(value: string): Date | null {
  let wall = normalizeAcademicTimestamp(value);
  if (!wall && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = new Date(value);
    if (Number.isFinite(instant.getTime())) wall = academicNow(instant);
  }
  return wall ? new Date(`${wall}Z`) : null;
}

export function isValidAcademicPeriod(period: AcademicWindow) {
  const start = normalizeAcademicTimestamp(period.startsAt);
  const end = normalizeAcademicTimestamp(period.endsAt);
  return Boolean(period.id && period.academicYear && /^(TERM_[1-9]\d*|SUMMER)$/.test(period.type) && start && end && end > start);
}
export function isPeriodStarted(period: AcademicWindow, now: Date) {
  return isValidAcademicPeriod(period) && academicNow(now) >= normalizeAcademicTimestamp(period.startsAt)!;
}
export function isPeriodActive(period: AcademicWindow, now: Date) {
  return period.active && isPeriodStarted(period, now) && academicNow(now) <= normalizeAcademicTimestamp(period.endsAt)!;
}
export function isPeriodPast(period: AcademicWindow, now: Date) {
  return isValidAcademicPeriod(period) && academicNow(now) > normalizeAcademicTimestamp(period.endsAt)!;
}
export function isStudentPeriodVisible(period: AcademicWindow, now: Date) {
  if (!period.active) return false;
  return period.type === "SUMMER" ? isPeriodActive(period, now) : isPeriodStarted(period, now);
}

export function buildAcademicVisibility(periods: AcademicWindow[], now: Date): AcademicVisibility {
  const current = periods.filter((period) => isPeriodActive(period, now));
  // Summer must never surface during an ordinary term, even with overlapping configuration.
  const summerAllowed = (period: AcademicWindow) => period.type !== "SUMMER" || !current.some(
    (other) => other.academicYear === period.academicYear && other.type !== "SUMMER",
  );
  return {
    periods,
    visiblePeriodIds: new Set(periods.filter((p) => isStudentPeriodVisible(p, now) && summerAllowed(p)).map((p) => p.id)),
    currentPeriodIds: new Set(current.filter(summerAllowed).map((p) => p.id)),
  };
}

export function isAcademicModuleVisible(
  module: PeriodModule, visibility: AcademicVisibility, role?: string | null, currentOnly = false,
) {
  if (role === "admin") return true;
  return Boolean(module.academicPeriodId && (currentOnly ? visibility.currentPeriodIds : visibility.visiblePeriodIds).has(module.academicPeriodId));
}

export function filterAcademicModules<T extends PeriodModule>(
  modules: T[], visibility: AcademicVisibility, role?: string | null, currentOnly = false,
): T[] {
  return modules.filter((module) => isAcademicModuleVisible(module, visibility, role, currentOnly)).sort(
    (a, b) => Number(visibility.currentPeriodIds.has(b.academicPeriodId ?? "")) - Number(visibility.currentPeriodIds.has(a.academicPeriodId ?? "")),
  );
}

export function academicConfigurationWarnings(periods: AcademicWindow[], modules: PeriodModule[]): string[] {
  const warnings: string[] = [];
  if (!periods.length) warnings.push("No academic periods configured. Student curriculum is hidden.");
  const valid = new Set(periods.filter(isValidAcademicPeriod).map((p) => p.id));
  const missing = modules.filter((m) => !m.academicPeriodId || !valid.has(m.academicPeriodId)).length;
  if (missing) warnings.push(`${missing} modules have no valid academic-period association and are hidden from students. Configure associations explicitly; do not infer dates or change curriculum automatically.`);
  for (const period of periods) {
    if (!isValidAcademicPeriod(period)) warnings.push(`Invalid dates/type for ${period.id}; students cannot discover this period.`);
    if (period.type !== "SUMMER" || !isValidAcademicPeriod(period)) continue;
    if (periods.some((p) => p.active && p.type !== "SUMMER" && p.academicYear === period.academicYear && isValidAcademicPeriod(p) && normalizeAcademicTimestamp(p.startsAt)! <= normalizeAcademicTimestamp(period.endsAt)! && normalizeAcademicTimestamp(p.endsAt)! >= normalizeAcademicTimestamp(period.startsAt)!)) {
      warnings.push(`Summer ${period.academicYear} overlaps an ordinary term. Summer stays hidden during that overlap.`);
    }
  }
  return warnings;
}
