import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), lecture: vi.fn(), periods: vi.fn(), entitled: vi.fn(),
  storage: vi.fn(), index: vi.fn(), retrieve: vi.fn(), stream: vi.fn(),
  reserve: vi.fn(), record: vi.fn(), streak: vi.fn(), local: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/shared/db", () => ({ db: {
  select: () => ({ from: mocks.periods }),
  query: { lecture: { findFirst: mocks.lecture } },
} }));
vi.mock("@/features/billing/queries", () => ({ hasModuleAccess: mocks.entitled }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/shared/storage", () => ({ streamFile: mocks.storage }));
vi.mock("@/features/rag", () => ({ getRAGIndex: mocks.index, retrieve: mocks.retrieve }));
vi.mock("@/shared/ai-client", () => ({ streamTutorReply: mocks.stream }));
vi.mock("@/features/ai/queries", () => ({
  reserveAiUsageSlot: mocks.reserve, recordAiUsage: mocks.record, FREE_DAILY_LIMIT: 15,
}));
vi.mock("@/features/gamification/queries", () => ({ updateStreak: mocks.streak }));
vi.mock("@/features/review/source-generators", () => ({ createSourceTutorReply: mocks.local }));

// REAL central release, period, entitlement and preview helpers; only IO is mocked.
import { GET as pdf, dynamic } from "@/app/api/content/pdf/[lectureId]/route";
import { POST as tutor } from "@/app/api/tutor/chat/route";

const student = { id: "student-a", role: "student" };
const admin = { id: "admin-a", role: "admin" };
const makeModule = (id = "paid", studyYear = 1, academicPeriodId: string | null = "current", isFree = false) => ({
  id, slug: id, name: `Module ${id}`, studyYear, academicPeriodId, isFree, term: 1,
});
const makeLecture = (id: string, module = makeModule()) => ({
  id, slug: id, title: `Trusted ${id}`, content: `Source ${id}`, summaryJson: null,
  pdfFile: `private/${id}.pdf`, moduleId: module.id, module, order: id === "preview" ? 0 : 1,
});
type Lecture = ReturnType<typeof makeLecture>;
const lectures = new Map<string, Lecture>();
const chunks = (rows: Lecture[]) => rows.map((row) => ({
  chunk: { lectureId: row.id, lectureTitle: row.title, moduleSlug: row.module.slug, text: row.content }, score: 1,
}));
function whereValue(where: unknown) {
  return (where as { queryChunks: { value?: unknown }[] }).queryChunks.find((chunk) => typeof chunk?.value === "string")?.value;
}
function pdfRequest(id = "paid-lecture") {
  return pdf(new NextRequest(`http://localhost/api/content/pdf/${id}`), { params: Promise.resolve({ lectureId: id }) });
}
function tutorRequest(id = "preview", extra: Record<string, unknown> = {}) {
  return tutor(new NextRequest("http://localhost/api/tutor/chat", { method: "POST", body: JSON.stringify({
    lectureId: id, messages: [{ role: "user", content: "Explain the source" }], ...extra,
  }) }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  vi.stubEnv("USE_HOSTED_AI", "true");
  vi.stubEnv("GROQ_API_KEY", "unit-test-placeholder-not-a-real-key");
  lectures.clear();
  lectures.set("preview", makeLecture("preview"));
  lectures.set("paid-lecture", makeLecture("paid-lecture"));
  mocks.session.mockResolvedValue({ user: student });
  mocks.periods.mockResolvedValue([
    { id: "current", academicYear: "test", type: "TERM_1", startsAt: "2026-09-01 00:00:00", endsAt: "2027-01-01 00:00:00", active: true },
    { id: "future", academicYear: "test", type: "TERM_2", startsAt: "2027-02-01 00:00:00", endsAt: "2027-06-01 00:00:00", active: true },
    { id: "summer", academicYear: "test", type: "SUMMER", startsAt: "2026-07-01 00:00:00", endsAt: "2026-08-01 00:00:00", active: true },
  ]);
  mocks.lecture.mockImplementation(async (args: { where: unknown; columns?: unknown }) => {
    const id = whereValue(args.where);
    return args.columns ? { id: "preview" } : lectures.get(String(id)) ?? null;
  });
  mocks.entitled.mockResolvedValue(false);
  mocks.storage.mockImplementation(async () => new Response("mock PDF bytes", { headers: {
    "Content-Type": "application/pdf", "Cache-Control": "public, s-maxage=604800",
  } }));
  mocks.index.mockResolvedValue({});
  mocks.retrieve.mockReturnValue(chunks([lectures.get("preview")!]));
  mocks.reserve.mockResolvedValue({ ok: true, count: 1 });
  mocks.stream.mockReturnValue({ toTextStreamResponse: () => new Response("Medical answer") });
  mocks.local.mockReturnValue("Source-only answer");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const deniedScopes = [
  ["year3", makeModule("year3", 3)], ["year4", makeModule("year4", 4)],
  ["year5", makeModule("year5", 5)], ["unmapped-year2", makeModule("year2", 2, null)],
  ["future", makeModule("future", 1, "future")], ["inactive-summer", makeModule("summer", 1, "summer")],
] as const;

describe("P0 protected PDF boundary", () => {
  it("anonymous is 401 before storage and never cacheable", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await pdfRequest();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it("unentitled paid lecture returns non-disclosing 404", async () => {
    const response = await pdfRequest();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it("entitled PDF works and all shared cache directives are disabled", async () => {
    mocks.entitled.mockResolvedValue(true);
    const response = await pdfRequest();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("mock PDF bytes");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
    expect(dynamic).toBe("force-dynamic");
  });
  it("copied exact URL reauthorizes B and anonymous after A", async () => {
    mocks.entitled.mockImplementation(async (id: string) => id === student.id);
    expect((await pdfRequest()).status).toBe(200);
    mocks.session.mockResolvedValue({ user: { id: "student-b", role: "student" } });
    expect((await pdfRequest()).status).toBe(404);
    mocks.session.mockResolvedValue(null);
    expect((await pdfRequest()).status).toBe(401);
    expect(mocks.storage).toHaveBeenCalledTimes(1);
  });
  it("changing a preview ID to the paid lecture does not grant PDF access", async () => {
    expect((await pdfRequest("preview")).status).toBe(200);
    expect((await pdfRequest("paid-lecture")).status).toBe(404);
    expect(mocks.storage).toHaveBeenCalledTimes(1);
  });
  it.each(deniedScopes)("%s PDF denied even with entitlement/free preview", async (id, module) => {
    lectures.set(id, makeLecture(id, module));
    mocks.entitled.mockResolvedValue(true);
    const response = await pdfRequest(id);
    expect(response.status).toBe(404);
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it("Admin keeps access to hidden-year PDFs", async () => {
    lectures.set("hidden", makeLecture("hidden", makeModule("hidden", 5, null)));
    mocks.session.mockResolvedValue({ user: admin });
    expect((await pdfRequest("hidden")).status).toBe(200);
  });
  it("revoked entitlement is rechecked on the next request", async () => {
    mocks.entitled.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect((await pdfRequest()).status).toBe(200);
    expect((await pdfRequest()).status).toBe(404);
  });
});

describe("P0 Tutor authorized context and all-user budget", () => {
  it("anonymous denied without quota/provider/persistence", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await tutorRequest()).status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it.each(deniedScopes)("%s entry denied before retrieval, quota, AI or writes", async (id, module) => {
    lectures.set(id, makeLecture(id, module));
    mocks.entitled.mockResolvedValue(true);
    const response = await tutorRequest(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "lecture not found" });
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.streak).not.toHaveBeenCalled();
  });
  it("direct unentitled paid entry is denied before AI", async () => {
    expect((await tutorRequest("paid-lecture")).status).toBe(404);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("valid preview still works, but denied same-module text/title never enters prompt/header", async () => {
    lectures.set("paid-lecture", { ...makeLecture("paid-lecture"), title: "DENIED_TITLE", content: "DENIED_TEXT" });
    mocks.retrieve.mockReturnValue(chunks([lectures.get("preview")!, lectures.get("paid-lecture")!]));
    const response = await tutorRequest();
    expect(response.status).toBe(200);
    const prompt = mocks.stream.mock.calls[0][0].system;
    expect(prompt).toContain("Source preview");
    expect(prompt).not.toContain("DENIED");
    expect(response.headers.get("X-Sources")).not.toContain("DENIED");
    expect(mocks.reserve).toHaveBeenCalledWith(student.id);
  });
  it.each(deniedScopes)("%s retrieval candidate is omitted without metadata disclosure", async (id, module) => {
    lectures.set(id, makeLecture(id, module));
    mocks.retrieve.mockReturnValue(chunks([lectures.get(id)!]));
    const response = await tutorRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Sources")).toBe("[]");
    expect(mocks.stream.mock.calls[0][0].system).not.toContain(`Source ${id}`);
  });
  it("DB-authorized source metadata replaces stale index metadata", async () => {
    mocks.retrieve.mockReturnValue([{ chunk: { lectureId: "preview", moduleSlug: "paid", lectureTitle: "stale-title", text: "Source preview" } }]);
    const response = await tutorRequest();
    expect(response.headers.get("X-Sources")).toContain("Trusted preview");
    expect(mocks.stream.mock.calls[0][0].system).not.toContain("stale-title");
  });
  it("cross-module and nonexistent index sources cannot be attached even when otherwise free", async () => {
    lectures.set("foreign", makeLecture("foreign", makeModule("other", 1, "current", true)));
    mocks.retrieve.mockReturnValue([...chunks([lectures.get("foreign")!]), { chunk: { lectureId: "deleted", text: "DELETED", moduleSlug: "paid" } }]);
    const response = await tutorRequest();
    expect(response.headers.get("X-Sources")).toBe("[]");
    expect(mocks.stream.mock.calls[0][0].system).not.toContain("DELETED");
  });
  it("client user/role/subscription/content/PDF/module claims do not authorize sources or quota", async () => {
    mocks.retrieve.mockReturnValue(chunks([lectures.get("paid-lecture")!]));
    const response = await tutorRequest("preview", {
      userId: "victim", role: "admin", hasSubscription: true, moduleId: "other", content: "CLIENT_CONTEXT", pdfFile: "private/secret.pdf",
    });
    expect(response.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledWith(student.id);
    expect(mocks.stream.mock.calls[0][0].system).not.toContain("CLIENT_CONTEXT");
    expect(response.headers.get("X-Sources")).toBe("[]");
  });
  it("entitled subscriber gets authorized content but is still bounded", async () => {
    mocks.entitled.mockResolvedValue(true);
    mocks.retrieve.mockReturnValue(chunks([lectures.get("paid-lecture")!]));
    const response = await tutorRequest("paid-lecture");
    expect(response.status).toBe(200);
    expect(mocks.stream.mock.calls[0][0].system).toContain("Source paid-lecture");
    expect(mocks.reserve).toHaveBeenCalledWith(student.id);
  });
  it.each([student, admin])("exhausted quota denies %j before AI/generated writes", async (actor) => {
    mocks.session.mockResolvedValue({ user: actor });
    mocks.entitled.mockResolvedValue(true); // valid subscription does not bypass quota
    mocks.reserve.mockResolvedValue({ ok: false, reason: "limit_reached" });
    const response = await tutorRequest();
    expect(response.status).toBe(429);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.streak).not.toHaveBeenCalled();
  });
  it("missing/failed quota state denies hosted work with 503", async () => {
    mocks.reserve.mockRejectedValue(new Error("DB unavailable"));
    expect((await tutorRequest()).status).toBe(503);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("parallel duplicate requests cannot turn the last slot into multiple provider calls", async () => {
    let used = 14;
    mocks.reserve.mockImplementation(async () => used >= 15 ? { ok: false } : { ok: true, count: ++used });
    const responses = await Promise.all(Array.from({ length: 10 }, () => tutorRequest()));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(9);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(used).toBe(15);
  });
  it("Admin keeps curriculum access while also reserving budget", async () => {
    mocks.session.mockResolvedValue({ user: admin });
    lectures.set("hidden", makeLecture("hidden", makeModule("hidden", 5, null)));
    mocks.retrieve.mockReturnValue(chunks([lectures.get("hidden")!]));
    expect((await tutorRequest("hidden")).status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledWith(admin.id);
  });
  it("local source mode remains usable without quota/provider even if quota storage is down", async () => {
    vi.stubEnv("USE_HOSTED_AI", "false");
    mocks.reserve.mockRejectedValue(new Error("Missing counter table"));
    expect((await tutorRequest()).status).toBe(200);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.local).toHaveBeenCalled();
    expect(mocks.streak).toHaveBeenCalledWith(student.id);
  });
  it("oversized request is rejected before quota/provider", async () => {
    expect((await tutorRequest("preview", { padding: "x".repeat(256 * 1024) })).status).toBe(413);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
