import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  module: vi.fn(), lecture: vi.fn(), lectures: vi.fn(), periods: vi.fn(), entitled: vi.fn(),
  session: vi.fn(), ragIndex: vi.fn(), retrieve: vi.fn(), generate: vi.fn(), usage: vi.fn(),
  beginGeneration: vi.fn(), createCards: vi.fn(), sourceCards: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/shared/db", () => ({ db: {
  select: () => ({ from: mocks.periods }),
  query: {
    curriculumModule: { findFirst: mocks.module },
    lecture: { findFirst: mocks.lecture, findMany: mocks.lectures },
  },
} }));
vi.mock("@/features/billing/queries", () => ({ hasModuleAccess: mocks.entitled }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/rag", () => ({ getRAGIndex: mocks.ragIndex, retrieve: mocks.retrieve }));
vi.mock("@/shared/ai-client", () => ({ generateJson: mocks.generate }));
vi.mock("@/features/ai/queries", () => ({ reserveAiUsageSlot: mocks.usage, FREE_DAILY_LIMIT: 10, recordAiUsage: vi.fn() }));
vi.mock("@/features/gamification/idempotency", () => ({ beginGeneration: mocks.beginGeneration, finalizeGeneration: vi.fn() }));
vi.mock("@/features/review/queries", () => ({ createFlashcards: mocks.createCards, getDueFlashcards: vi.fn() }));
vi.mock("@/features/review/source-generators", () => ({ createSourceFlashcards: mocks.sourceCards }));

// Deliberately use the REAL central release/period resolver, not a mocked allow/deny result.
import { canAccessModule, getAccessibleLecture, getAccessibleModuleBySlug } from "./learning-access";
import { GET as search } from "@/app/api/search/route";
import { POST as generateFlashcards } from "@/app/api/review/flashcards/route";

const student = { id: "test-student", role: "student" };
const moduleFor = (studyYear: number) => ({
  id: `test-module-${studyYear}`, slug: `test-year-${studyYear}`, studyYear,
  isFree: true, term: studyYear * 2 - 1, academicPeriodId: "test-active",
});
const lectureFor = (studyYear: number) => ({
  id: `test-lecture-${studyYear}`, slug: `test-lecture-${studyYear}`, content: "Private test source",
  moduleId: moduleFor(studyYear).id, module: moduleFor(studyYear),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  mocks.periods.mockResolvedValue([{
    id: "test-active", academicYear: "test-calendar", type: "TERM_1",
    startsAt: "2026-09-01 00:00:00", endsAt: "2027-02-28 23:59:59.999", active: true,
  }]);
  mocks.entitled.mockResolvedValue(true);
  mocks.module.mockResolvedValue(moduleFor(3));
  mocks.lecture.mockResolvedValue(lectureFor(3));
  mocks.session.mockResolvedValue({ user: student });
});
afterEach(() => vi.useRealTimers());

describe("server authorization for unreleased academic years", () => {
  it.each([3, 4, 5])("Year %i is denied even if free and entitled", async (year) => {
    expect(await canAccessModule(student, moduleFor(year))).toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.entitled).not.toHaveBeenCalled();
  });
  it("a direct Year-3 module slug cannot bypass release", async () => {
    expect((await getAccessibleModuleBySlug(student, "test-year-3")).ok).toBe(false);
  });
  it("a direct Year-3 lecture ID cannot use first-lecture preview", async () => {
    expect(await getAccessibleLecture(student, "test-lecture-3", { allowPreview: true })).toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.lecture).toHaveBeenCalledTimes(1);
  });
  it.each([3, 4, 5])("admin still accesses Year-%i modules and lectures", async (year) => {
    const admin = { id: "test-admin", role: "admin" };
    mocks.lecture.mockResolvedValue(lectureFor(year));
    expect((await canAccessModule(admin, moduleFor(year))).ok).toBe(true);
    expect((await getAccessibleLecture(admin, `test-lecture-${year}`)).ok).toBe(true);
  });
  it("Year 2 remains accessible when released AND its own period is current", async () => {
    expect((await canAccessModule(student, moduleFor(2))).ok).toBe(true);
  });
  it("Year-5 search hits are filtered without returning source/title metadata", async () => {
    mocks.lecture.mockResolvedValue(lectureFor(5));
    mocks.lectures.mockResolvedValue([{ id: "test-lecture-5", slug: "test-lecture-5" }]);
    mocks.ragIndex.mockResolvedValue({});
    mocks.retrieve.mockReturnValue([{
      chunk: { lectureId: "test-lecture-5", lectureTitle: "Private Year Five", moduleSlug: "test-year-5", text: "Private test source" }, score: 1,
    }]);
    const response = await search(new NextRequest("http://localhost/api/search?q=private&module=test-year-5"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ query: "private", results: [] });
  });
  it("hidden-year study-tool generation is denied before AI, quota or persistence", async () => {
    const request = new NextRequest("http://localhost/api/review/flashcards", {
      method: "POST", body: JSON.stringify({ lectureId: "test-lecture-3", idempotencyKey: "test-request" }),
    });
    const response = await generateFlashcards(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "lecture not found" });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.sourceCards).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.beginGeneration).not.toHaveBeenCalled();
    expect(mocks.createCards).not.toHaveBeenCalled();
  });
});
