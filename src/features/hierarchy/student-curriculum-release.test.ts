import { describe, expect, it } from "vitest";
import { isStudentAcademicYearReleased, STUDENT_RELEASED_ACADEMIC_YEARS } from "./student-curriculum-release";
import { buildAcademicVisibility, filterAcademicModules, isAcademicModuleVisible, type AcademicWindow } from "./academic-visibility";

const period: AcademicWindow = {
  id: "test-active-period", academicYear: "test-calendar", type: "TERM_1",
  startsAt: "2026-09-01 00:00:00", endsAt: "2027-02-28 23:59:59.999", active: true,
};
const now = new Date("2026-10-03T12:00:00Z");
const visibility = buildAcademicVisibility([period], now);
const moduleFor = (studyYear: number) => ({ id: `year-${studyYear}`, studyYear, academicPeriodId: period.id });

describe("central student curriculum release", () => {
  it("has one editable release configuration for Years 1 and 2", () => {
    expect(STUDENT_RELEASED_ACADEMIC_YEARS).toEqual([1, 2]);
  });
  it.each([[1, true], [2, true], [3, false], [4, false], [5, false]] as const)(
    "Year %i release permission is %s", (year, released) => {
      expect(isStudentAcademicYearReleased(year)).toBe(released);
    },
  );
  it.each([undefined, null, 0, 6, 1.5])("unknown/invalid year %s fails closed", (year) => {
    expect(isStudentAcademicYearReleased(year)).toBe(false);
  });
});

describe("release AND academic-period visibility", () => {
  it.each([3, 4, 5])("Year %i is hidden even with an enabled current period", (year) => {
    expect(isAcademicModuleVisible(moduleFor(year), visibility, "student")).toBe(false);
    expect(filterAcademicModules([moduleFor(year)], visibility, "student", true)).toEqual([]);
  });
  it("unknown year cannot pass pure discovery even with a valid association", () => {
    expect(isAcademicModuleVisible({ academicPeriodId: period.id }, visibility, "student")).toBe(false);
  });
  it("released Year 2 still waits for its own period's start", () => {
    const future = { ...period, id: "test-year-2-period", academicYear: "test-future-calendar", startsAt: "2027-09-01 00:00:00", endsAt: "2028-02-29 23:59:59.999" };
    const moduleRecord = { ...moduleFor(2), academicPeriodId: future.id };
    expect(isAcademicModuleVisible(moduleRecord, buildAcademicVisibility([future], now))).toBe(false);
    expect(isAcademicModuleVisible(moduleRecord, buildAcademicVisibility([future], new Date("2027-10-03T12:00:00Z")))).toBe(true);
  });
  it("released Year 2 without an approved period stays hidden", () => {
    expect(isAcademicModuleVisible({ ...moduleFor(2), academicPeriodId: null }, visibility)).toBe(false);
  });
  it("student module and lecture totals include only visible released content", () => {
    const modules = [1, 2, 3, 4, 5].map((year) => ({ ...moduleFor(year), totalLectures: year * 10 }));
    const visible = filterAcademicModules(modules, visibility, "student");
    expect(visible.map((module) => module.studyYear)).toEqual([1, 2]);
    expect(visible).toHaveLength(2);
    expect(visible.reduce((total, module) => total + module.totalLectures, 0)).toBe(30);
  });
  it("admin retains all years, including missing associations", () => {
    const modules = [1, 2, 3, 4, 5].map((year) => ({ ...moduleFor(year), academicPeriodId: null }));
    expect(filterAcademicModules(modules, visibility, "admin")).toHaveLength(5);
  });
  it("historical regular-period access is retained only for released years", () => {
    const past = buildAcademicVisibility([period], new Date("2027-04-03T12:00:00Z"));
    expect(filterAcademicModules([moduleFor(2), moduleFor(3)], past).map((module) => module.studyYear)).toEqual([2]);
    expect(filterAcademicModules([moduleFor(2)], past, "student", true)).toEqual([]);
  });
  it("Summer retains its date rules and also requires a released year", () => {
    const summer = { ...period, id: "test-summer", type: "SUMMER", startsAt: "2027-07-01 00:00:00", endsAt: "2027-09-15 23:59:59.999" };
    const modules = [1, 2, 3, 4, 5].map((year) => ({ ...moduleFor(year), academicPeriodId: summer.id }));
    expect(filterAcademicModules(modules, buildAcademicVisibility([summer], now))).toEqual([]);
    const activeSummer = buildAcademicVisibility([summer], new Date("2027-08-03T12:00:00Z"));
    expect(filterAcademicModules(modules, activeSummer).map((module) => module.studyYear)).toEqual([1, 2]);
    expect(filterAcademicModules(modules, buildAcademicVisibility([summer], new Date("2027-10-03T12:00:00Z")))).toEqual([]);
  });
});
