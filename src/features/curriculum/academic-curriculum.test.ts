import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAcademicVisibility, type AcademicWindow } from "@/features/hierarchy/academic-visibility";
const mocks = vi.hoisted(() => ({ modules: vi.fn(), curriculum: vi.fn(), visibility: vi.fn() }));
vi.mock("@/shared/db", () => ({ db: { query: { curriculumModule: { findMany: mocks.modules } } } }));
vi.mock("./queries", () => ({ getCurriculum: mocks.curriculum }));
vi.mock("@/features/hierarchy/academic-visibility-server", () => ({ getAcademicVisibility: mocks.visibility }));
import { getAcademicCurriculum, getAcademicModuleBySlug, getAcademicStudyYears } from "./academic-curriculum";
const student = { id: "student", role: "student" };
const records = [
  { id: "m1", slug: "term1", studyYear: 1, academicPeriodId: "t1" },
  { id: "m2", slug: "term2", studyYear: 2, academicPeriodId: "t2" },
  { id: "ms", slug: "summer", studyYear: 1, academicPeriodId: "s" },
  { id: "m3", slug: "unlinked", studyYear: 3, academicPeriodId: null },
];
const periods: AcademicWindow[] = [
  { id: "t1", academicYear: "2026-2027", type: "TERM_1", startsAt: "2026-09-01T00:00", endsAt: "2027-02-28T23:59", active: true },
  { id: "t2", academicYear: "2026-2027", type: "TERM_2", startsAt: "2027-03-01T00:00", endsAt: "2027-06-30T23:59", active: true },
  { id: "s", academicYear: "2026-2027", type: "SUMMER", startsAt: "2027-07-01T00:00", endsAt: "2027-09-15T23:59", active: true },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.modules.mockResolvedValue(records);
  mocks.curriculum.mockResolvedValue(records);
  mocks.visibility.mockResolvedValue(buildAcademicVisibility(periods, new Date("2026-10-03T12:00:00Z")));
});
describe("database-backed discovery boundaries", () => {
  it("year selector does not expose all existing curriculum years", async () => expect(await getAcademicStudyYears(student)).toEqual([1]));
  it("Modules loader strips future content before returning to the page", async () => expect((await getAcademicCurriculum(student)).map((m) => m.id)).toEqual(["m1"]));
  it("manual future module URL cannot find a record", async () => expect(await getAcademicModuleBySlug(student, "term2")).toBeNull());
  it("unassociated modules are never guessed from term/year/slug", async () => expect(await getAcademicModuleBySlug(student, "unlinked")).toBeNull());
  it("current-period Dashboard excludes historical content", async () => {
    mocks.visibility.mockResolvedValue(buildAcademicVisibility(periods, new Date("2027-04-03T12:00:00Z")));
    expect((await getAcademicCurriculum(student, undefined, true)).map((m) => m.id)).toEqual(["m2"]);
    expect((await getAcademicCurriculum(student)).map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(await getAcademicStudyYears(student, true)).toEqual([2]);
  });
  it("missing config produces an empty selector, not an invented academic year", async () => {
    mocks.visibility.mockResolvedValue(buildAcademicVisibility([], new Date()));
    expect(await getAcademicStudyYears(student)).toEqual([]);
    expect(await getAcademicCurriculum(student)).toEqual([]);
  });
  it("admin still discovers all configured and unconfigured years/modules", async () => {
    expect(await getAcademicStudyYears({ id: "admin", role: "admin" })).toEqual([1, 2, 3]);
    expect(await getAcademicCurriculum({ id: "admin", role: "admin" })).toHaveLength(4);
  });
});
