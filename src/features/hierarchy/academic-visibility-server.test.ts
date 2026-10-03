import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ periods: vi.fn(), module: vi.fn(), select: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/shared/db", () => ({ db: {
  select: (fields: unknown) => { mocks.select(fields); return { from: mocks.periods }; },
  query: { curriculumModule: { findFirst: mocks.module } },
} }));
import { getAcademicPeriods, isModuleAcademicallyVisible } from "./academic-visibility-server";
const actor = { role: "student" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  mocks.periods.mockResolvedValue([
    { id: "t1", academicYear: "2026-2027", type: "TERM_1", startsAt: "2026-09-01 00:00:00", endsAt: "2027-02-28 23:59:59.999", active: true },
    { id: "t2", academicYear: "2026-2027", type: "TERM_2", startsAt: "2027-03-01 00:00:00", endsAt: "2027-07-31 23:59:59.999", active: true },
  ]);
  mocks.module.mockResolvedValue({ academicPeriodId: "t2" });
});
afterEach(() => vi.useRealTimers());
describe("authoritative DB period resolver", () => {
  it("reads raw timestamp-without-timezone strings without driver UTC reinterpretation", async () => {
    expect((await getAcademicPeriods())[0].startsAt).toBe("2026-09-01 00:00:00");
    expect(mocks.select).toHaveBeenCalled();
  });
  it("resolves a minimal result/analytics module guard through its database ID", async () => {
    expect(await isModuleAcademicallyVisible(actor, { id: "module" })).toBe(false);
    expect(mocks.module).toHaveBeenCalledTimes(1);
  });
  it("full records use the actual period foreign key", async () => {
    expect(await isModuleAcademicallyVisible(actor, { id: "module", academicPeriodId: "t1" })).toBe(true);
    expect(mocks.module).not.toHaveBeenCalled();
  });
  it("unconfigured and deleted modules fail closed", async () => {
    expect(await isModuleAcademicallyVisible(actor, { id: "module", academicPeriodId: null })).toBe(false);
    mocks.module.mockResolvedValue(undefined);
    expect(await isModuleAcademicallyVisible(actor, { id: "missing" })).toBe(false);
  });
  it("admin sees future/unconfigured modules without the student gate", async () => {
    expect(await isModuleAcademicallyVisible({ role: "admin" }, { id: "module" })).toBe(true);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.module).not.toHaveBeenCalled();
  });
  it("unauthenticated callers cannot use the visibility resolver", async () => expect(await isModuleAcademicallyVisible(null, { id: "module" })).toBe(false));
  it("empty config never falls back to a term label or subscription", async () => {
    mocks.periods.mockResolvedValue([]);
    expect(await isModuleAcademicallyVisible(actor, { id: "module", academicPeriodId: "t1" })).toBe(false);
  });
});
