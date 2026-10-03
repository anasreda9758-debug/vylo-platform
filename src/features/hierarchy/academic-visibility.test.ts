import { describe, expect, it } from "vitest";
import {
  academicNow, academicConfigurationWarnings, academicTimestampForStorage, buildAcademicVisibility, filterAcademicModules,
  isAcademicModuleVisible, isPeriodActive, isPeriodPast, isPeriodStarted, isStudentPeriodVisible,
  normalizeAcademicTimestamp, type AcademicWindow,
} from "./academic-visibility";

const term1: AcademicWindow = { id: "t1", academicYear: "2026-2027", type: "TERM_1", startsAt: "2026-09-01 00:00:00", endsAt: "2027-02-28 23:59:59.999", active: true };
const term2: AcademicWindow = { ...term1, id: "t2", type: "TERM_2", startsAt: "2027-03-01 00:00:00", endsAt: "2027-06-30 23:59:59.999" };
const summer: AcademicWindow = { ...term1, id: "summer", type: "SUMMER", startsAt: "2027-07-01 00:00:00", endsAt: "2027-09-15 23:59:59.999" };
const periods = [term1, term2, summer];
const modules = [
  { id: "m1", studyYear: 1, academicPeriodId: "t1" },
  { id: "m2", studyYear: 1, academicPeriodId: "t2" },
  { id: "ms", studyYear: 1, academicPeriodId: "summer" },
  { id: "future-year", studyYear: 2, academicPeriodId: null },
];
const date = (value: string) => new Date(value);
const inTerm1 = date("2026-10-03T12:00:00Z");
const inTerm2 = date("2027-04-03T12:00:00Z");
const inSummer = date("2027-08-03T12:00:00Z");

describe("Cairo academic boundaries", () => {
  it("hides Term 1 one millisecond before Cairo midnight", () => expect(isStudentPeriodVisible(term1, date("2026-08-31T20:59:59.999Z"))).toBe(false));
  it("shows Term 1 exactly on its start date", () => expect(isStudentPeriodVisible(term1, date("2026-08-31T21:00:00Z"))).toBe(true));
  it("shows Term 1 while active", () => expect(isPeriodActive(term1, inTerm1)).toBe(true));
  it("hides future Term 2 during Term 1", () => expect(isStudentPeriodVisible(term2, inTerm1)).toBe(false));
  it("shows Term 2 on its Cairo winter start boundary", () => expect(isStudentPeriodVisible(term2, date("2027-02-28T22:00:00Z"))).toBe(true));
  it("keeps past Term 1 for historical access in Term 2", () => {
    expect(isStudentPeriodVisible(term1, inTerm2)).toBe(true);
    expect(isPeriodPast(term1, inTerm2)).toBe(true);
    expect(isPeriodActive(term1, inTerm2)).toBe(false);
  });
  it("hides Summer during Term 2", () => expect(isStudentPeriodVisible(summer, inTerm2)).toBe(false));
  it("hides Summer immediately before its start", () => expect(isStudentPeriodVisible(summer, date("2027-06-30T20:59:59.999Z"))).toBe(false));
  it("shows Summer on its start and during its dates", () => {
    expect(isStudentPeriodVisible(summer, date("2027-06-30T21:00:00Z"))).toBe(true);
    expect(isStudentPeriodVisible(summer, inSummer)).toBe(true);
  });
  it("hides Summer after end, including history", () => expect(isStudentPeriodVisible(summer, date("2027-09-15T21:00:00Z"))).toBe(false));
  it("treats the configured end as inclusive", () => expect(isPeriodActive(summer, date("2027-09-15T20:59:59.999Z"))).toBe(true));
  it("does not equate active=true with a started period", () => expect(isPeriodStarted(term2, inTerm1)).toBe(false));
  it("uses Africa/Cairo DST, not a fixed UTC offset", () => {
    expect(academicNow(date("2027-01-01T22:00:00Z"))).toBe("2027-01-02T00:00:00.000");
    expect(academicNow(date("2027-08-01T21:00:00Z"))).toBe("2027-08-02T00:00:00.000");
  });
  it.each(["not a date", "2027-02-30T00:00", "2027-07-01T24:00", "2027-07-01T00:00Z"])("rejects ambiguous or invalid wall time %s", (value) => expect(normalizeAcademicTimestamp(value)).toBeNull());
  it("normalizes datetime-local without parsing it in the browser timezone", () => expect(normalizeAcademicTimestamp("2027-07-01T00:00")).toBe("2027-07-01T00:00:00.000"));
  it("stores Cairo wall time, not host-local datetime parsing", () => expect(academicTimestampForStorage("2027-07-01T00:00")?.toISOString()).toBe("2027-07-01T00:00:00.000Z"));
  it("converts explicit-offset API inputs to Cairo wall time", () => expect(academicTimestampForStorage("2027-06-30T21:00:00Z")?.toISOString()).toBe("2027-07-01T00:00:00.000Z"));
});

describe("shared curriculum visibility", () => {
  it("admin still sees future, missing associations and Summer", () => expect(filterAcademicModules(modules, buildAcademicVisibility(periods, inTerm1), "admin")).toHaveLength(4));
  it("a direct request for a future module is denied even if it is free/entitled", () => expect(isAcademicModuleVisible(modules[1], buildAcademicVisibility(periods, inTerm1), "student")).toBe(false));
  it.each([inTerm1, inTerm2, inSummer])("Dashboard uses current period only at %s", (now) => {
    const selected = filterAcademicModules(modules, buildAcademicVisibility(periods, now), "student", true);
    expect(selected.map((m) => m.id)).toEqual([now === inTerm1 ? "m1" : now === inTerm2 ? "m2" : "ms"]);
  });
  it("Modules excludes future terms and unconfigured future years", () => expect(filterAcademicModules(modules, buildAcademicVisibility(periods, inTerm1)).map((m) => m.id)).toEqual(["m1"]));
  it("Modules retains past terms but prioritizes the current term", () => expect(filterAcademicModules(modules, buildAcademicVisibility(periods, inTerm2)).map((m) => m.id)).toEqual(["m2", "m1"]));
  it("missing configuration fails safely", () => expect(filterAcademicModules(modules, buildAcademicVisibility([], inTerm1))).toEqual([]));
  it("unknown associations fail safely", () => expect(isAcademicModuleVisible({ academicPeriodId: "deleted" }, buildAcademicVisibility(periods, inTerm1))).toBe(false));
  it("disabled periods are hidden", () => expect(isStudentPeriodVisible({ ...term1, active: false }, inTerm1)).toBe(false));
  it("invalid dates fail safely", () => expect(isStudentPeriodVisible({ ...term1, endsAt: term1.startsAt }, inTerm1)).toBe(false));
  it("Summer stays hidden during an overlapping ordinary term", () => {
    const context = buildAcademicVisibility([term1, { ...term2, endsAt: "2027-07-31 23:59:59.999" }, summer], date("2027-07-15T12:00:00Z"));
    expect(context.visiblePeriodIds.has(summer.id)).toBe(false);
    expect(context.currentPeriodIds.has(summer.id)).toBe(false);
  });
  it("shows configuration warnings for unlinked modules and overlap", () => {
    const warnings = academicConfigurationWarnings([term1, { ...term2, endsAt: "2027-07-31 23:59:59.999" }, summer], modules);
    expect(warnings.some((w) => w.includes("1 modules"))).toBe(true);
    expect(warnings.some((w) => w.includes("overlaps"))).toBe(true);
  });
  it("warns rather than guessing dates when no periods exist", () => expect(academicConfigurationWarnings([], modules)[0]).toContain("No academic periods"));
});
