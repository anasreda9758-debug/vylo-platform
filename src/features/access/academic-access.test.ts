import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ visible: vi.fn(), entitled: vi.fn(), lecture: vi.fn(), module: vi.fn() }));
vi.mock("@/features/hierarchy/academic-visibility-server", () => ({ isModuleAcademicallyVisible: mocks.visible }));
vi.mock("@/features/billing/queries", () => ({ hasModuleAccess: mocks.entitled }));
vi.mock("@/shared/db", () => ({ db: { query: { lecture: { findFirst: mocks.lecture }, curriculumModule: { findFirst: mocks.module } } } }));
import { canAccessModule, getAccessibleLecture, getAccessibleModuleBySlug } from "./learning-access";

const student = { id: "student", role: "student" };
const moduleRecord = { id: "module", slug: "future", isFree: true, term: 2, academicPeriodId: "t2" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.visible.mockResolvedValue(false);
  mocks.entitled.mockResolvedValue(true);
  mocks.lecture.mockResolvedValue({ id: "first", moduleId: moduleRecord.id, module: moduleRecord });
  mocks.module.mockResolvedValue(moduleRecord);
});
describe("academic restriction precedes every entitlement/preview", () => {
  it("future free modules are not discoverable", async () => expect(await canAccessModule(student, moduleRecord)).toMatchObject({ ok: false, reason: "not_found" }));
  it("a valid subscription cannot bypass a future period", async () => {
    expect((await canAccessModule(student, { ...moduleRecord, isFree: false })).ok).toBe(false);
    expect(mocks.entitled).not.toHaveBeenCalled();
  });
  it("URL module slug changes do not disclose a future module", async () => expect((await getAccessibleModuleBySlug(student, "future")).ok).toBe(false));
  it("first-lecture preview never bypasses academic visibility", async () => {
    expect(await getAccessibleLecture(student, "first", { allowPreview: true })).toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.lecture).toHaveBeenCalledTimes(1);
  });
  it("visible historical paid content still needs entitlement", async () => {
    mocks.visible.mockResolvedValue(true);
    mocks.entitled.mockResolvedValue(false);
    expect(await canAccessModule(student, { ...moduleRecord, isFree: false })).toMatchObject({ ok: false, reason: "forbidden" });
  });
  it("admin management bypasses student time restrictions", async () => {
    expect((await canAccessModule({ id: "admin", role: "admin" }, moduleRecord)).ok).toBe(true);
    expect(mocks.visible).not.toHaveBeenCalled();
  });
  it("visible entitled modules preserve access", async () => {
    mocks.visible.mockResolvedValue(true);
    expect((await canAccessModule(student, moduleRecord)).ok).toBe(true);
  });
});
