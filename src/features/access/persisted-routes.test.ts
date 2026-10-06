import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const io = vi.hoisted(() => ({ session: vi.fn(), periods: vi.fn(), entitled: vi.fn(), lecture: vi.fn(),
  card: vi.fn(), case: vi.fn(), attempt: vi.fn(), exam: vi.fn(), module: vi.fn(),
  notes: vi.fn(), insert: vi.fn(), deletion: vi.fn(), review: vi.fn(), evaluate: vi.fn(), finish: vi.fn(),
  saveStation: vi.fn(), finishExam: vi.fn(), localEvaluation: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/session", () => ({ getSession: io.session }));
vi.mock("@/features/billing/queries", () => ({ hasModuleAccess: io.entitled }));
vi.mock("@/shared/db", () => ({ db: {
  select: () => ({ from: io.periods }),
  query: { lecture: { findFirst: io.lecture }, flashcard: { findFirst: io.card },
    clinicalCase: { findFirst: io.case }, quizAttempt: { findFirst: io.attempt },
    ospeExam: { findFirst: io.exam }, curriculumModule: { findFirst: io.module }, lectureNote: { findMany: io.notes } },
  insert: () => ({ values: io.insert }), delete: () => ({ where: io.deletion }),
} }));
vi.mock("@/features/review/queries", () => ({ reviewFlashcard: io.review, createClinicalCaseEvaluation: io.evaluate }));
vi.mock("@/features/practice/queries", () => ({ finishAttempt: io.finish }));
vi.mock("@/features/ospe/exam", () => ({ submitStationAnswer: io.saveStation, finishExam: io.finishExam }));
vi.mock("@/features/review/source-generators", () => ({ evaluateSourceAnswers: io.localEvaluation }));
vi.mock("@/features/gamification/queries", () => ({ awardXp: vi.fn(), updateStreak: vi.fn() }));
vi.mock("@/features/ai/queries", () => ({ FREE_DAILY_LIMIT: 15, reserveAiUsageSlot: vi.fn(), recordAiUsage: vi.fn() }));
vi.mock("@/shared/ai-client", () => ({ generateJson: vi.fn() }));

import { getAccessibleFlashcard, getAccessibleClinicalCase, getAccessibleQuizAttempt, getAccessibleOspeExam } from "./learning-access";
import { POST as reviewCard } from "@/app/api/review/flashcards/review/route";
import { POST as evaluateCase } from "@/app/api/review/cases/evaluate/route";
import { POST as finishQuiz } from "@/app/api/quiz/finish/route";
import { GET as readExam, POST as updateExam } from "@/app/api/ospe/exam/[examId]/route";
import { GET as readNotes, POST as createNote, DELETE as deleteNote } from "@/app/api/lecture-notes/route";

const a = { id: "student-a", role: "student" };
const b = { id: "student-b", role: "student" };
const dialect = new PgDialect();
let scope = "visible";
const moduleRow = () => ({ id: "module", slug: "rau-203", term: 1, isFree: scope !== "paid",
  studyYear: /^year[345]$/.test(scope) ? Number(scope.at(-1)) : 1,
  academicPeriodId: ["future", "summer"].includes(scope) ? scope : "current" });
const record = () => ({ id: "record", userId: a.id, lectureId: "source" });
const req = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const examParams = { params: Promise.resolve({ examId: "record" }) };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  vi.stubEnv("GROQ_API_KEY", ""); scope = "visible";
  io.session.mockResolvedValue({ user: a }); io.entitled.mockResolvedValue(false);
  io.periods.mockResolvedValue([
    { id: "current", type: "TERM_1", active: true, startsAt: "2026-09-01 00:00:00", endsAt: "2027-01-01 00:00:00" },
    { id: "future", type: "TERM_2", active: true, startsAt: "2027-02-01 00:00:00", endsAt: "2027-06-01 00:00:00" },
    { id: "summer", type: "SUMMER", active: true, startsAt: "2026-07-01 00:00:00", endsAt: "2026-08-01 00:00:00" },
  ].map(period => ({ ...period, academicYear: "test-calendar" })));
  io.lecture.mockImplementation(({ columns }) => columns ? { id: "first" } : { id: "source", module: moduleRow() });
  io.module.mockImplementation(moduleRow);
  io.card.mockImplementation(record);
  io.case.mockImplementation(() => ({ ...record(), questionsJson: '["fixture question"]', modelAnswersJson: '["fixture answer"]' }));
  io.attempt.mockImplementation(() => ({ ...record(), bankId: "bank", bank: { id: "bank", module: moduleRow() } }));
  io.exam.mockImplementation(() => ({ ...record(), practicalTrackId: null, status: "in_progress",
    stations: [{ id: "station", folder: "RENAL", order: 0, fileName: "fixture", studentAnswer: null, timeSpentSec: 0, score: 0 }] }));
  io.review.mockResolvedValue({ wasDue: false }); io.localEvaluation.mockResolvedValue({ score: 50, feedback: "fixture feedback" });
  io.finish.mockResolvedValue({ score: 1, total: 1 }); io.finishExam.mockResolvedValue({ totalScore: 1 });
  io.notes.mockImplementation(({ where }) => dialect.sqlToQuery(where).params.includes(a.id) ? [{ id: "note", userId: a.id, body: "private note" }] : []);
  io.insert.mockImplementation(value => ({ returning: async () => [value] }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe.each([
  ["card", getAccessibleFlashcard], ["case", getAccessibleClinicalCase],
  ["quiz attempt", getAccessibleQuizAttempt], ["OSPE exam", getAccessibleOspeExam],
] as const)("private %s detail", (_name, guard) => {
  it("owner can read while source remains accessible", async () => expect((await guard(a, "record")).ok).toBe(true));
  it("B is not told whether A's record exists", async () => expect(await guard(b, "record")).toMatchObject({ ok: false, reason: "not_found" }));
  it("anonymous is denied", async () => expect((await guard(null, "record")).ok).toBe(false));
  it("Admin curriculum privileges do not bypass private ownership", async () =>
    expect((await guard({ id: "admin", role: "admin" }, "record")).ok).toBe(false));
  it.each(["paid", "year3", "year4", "year5", "future", "summer"])("saved %s source cannot be retrieved", async denied => {
    scope = denied; expect((await guard(a, "record")).ok).toBe(false);
  });
});

const updates = [
  ["card review", () => reviewCard(req("/api/review/flashcards/review", { cardId: "record", rating: "good", userId: b.id, role: "admin" })), io.review],
  ["case evaluation", () => evaluateCase(req("/api/review/cases/evaluate", { caseId: "record", answers: ["fixture"], userId: b.id })), io.evaluate],
  ["quiz completion", () => finishQuiz(req("/api/quiz/finish", { attemptId: "record", userId: b.id })), io.finish],
  ["OSPE answer", () => updateExam(req("/api/ospe/exam/record", { action: "answer", stationId: "station", answer: "fixture", userId: b.id }), examParams), io.saveStation],
] as const;
describe.each(updates)("private %s mutation", (_name, call, write) => {
  it("owner may update; client cannot reassign the owner", async () => {
    expect((await call()).status).toBe(200); expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(write.mock.calls)).not.toContain(b.id);
  });
  it("another student cannot update A's record", async () => {
    io.session.mockResolvedValue({ user: b }); expect((await call()).status).toBe(404); expect(write).not.toHaveBeenCalled();
  });
  it("anonymous cannot update", async () => {
    io.session.mockResolvedValue(null); expect((await call()).status).toBe(401); expect(write).not.toHaveBeenCalled();
  });
  it("lost curriculum entitlement blocks mutation", async () => {
    scope = "paid"; expect((await call()).status).toBe(404); expect(write).not.toHaveBeenCalled();
  });
});

describe("notes read/create/delete and OSPE read routes", () => {
  it("note list only contains the authenticated owner's data", async () => {
    const response = await readNotes(req("/api/lecture-notes?lectureId=source&userId=student-b"));
    expect(response.status).toBe(200); expect((await response.json()).notes[0].userId).toBe(a.id);
    io.session.mockResolvedValue({ user: b });
    expect((await (await readNotes(req("/api/lecture-notes?lectureId=source&userId=student-a"))).json()).notes).toEqual([]);
  });
  it("note create uses explicit server fields, ignoring ownership and access assignments", async () => {
    const response = await createNote(req("/api/lecture-notes", { lectureId: "source", body: "fixture note", userId: b.id, role: "admin", moduleId: "other" }));
    expect(response.status).toBe(201);
    expect(io.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: a.id, lectureId: "source" }));
    expect(io.insert.mock.calls[0][0]).not.toHaveProperty("role");
    expect(io.insert.mock.calls[0][0]).not.toHaveProperty("moduleId");
  });
  it("note delete scopes both ID and owner; B never deletes A's record", async () => {
    const fixture = { id: "note-a", userId: a.id };
    let deleted = false;
    io.deletion.mockImplementation(where => {
      const params = dialect.sqlToQuery(where as SQL).params;
      deleted = params.includes(fixture.id) && params.includes(fixture.userId);
    });
    io.session.mockResolvedValue({ user: b });
    expect((await deleteNote(req("/api/lecture-notes?id=note-a&userId=student-a", undefined, "DELETE"))).status).toBe(200);
    expect(deleted).toBe(false); // indistinguishable no-op, no record-existence disclosure
    io.session.mockResolvedValue({ user: a });
    expect((await deleteNote(req("/api/lecture-notes?id=note-a", undefined, "DELETE"))).status).toBe(200);
    expect(deleted).toBe(true);
  });
  it("anonymous notes read/create/delete are denied before data access", async () => {
    io.session.mockResolvedValue(null);
    expect((await readNotes(req("/api/lecture-notes?lectureId=source"))).status).toBe(401);
    expect((await createNote(req("/api/lecture-notes", { lectureId: "source", body: "fixture" }))).status).toBe(401);
    expect((await deleteNote(req("/api/lecture-notes?id=note", undefined, "DELETE"))).status).toBe(401);
    expect(io.notes).not.toHaveBeenCalled(); expect(io.insert).not.toHaveBeenCalled(); expect(io.deletion).not.toHaveBeenCalled();
  });
  it.each(["paid", "year3", "year4", "year5", "future", "summer"])("stored %s notes are denied before read/create", async denied => {
    scope = denied;
    expect((await readNotes(req("/api/lecture-notes?lectureId=source"))).status).toBe(403);
    expect((await createNote(req("/api/lecture-notes", { lectureId: "source", body: "fixture" }))).status).toBe(403);
    expect(io.notes).not.toHaveBeenCalled(); expect(io.insert).not.toHaveBeenCalled();
  });
  it("OSPE read does not reveal A's saved answers to B", async () => {
    expect((await readExam(req("/api/ospe/exam/record"), examParams)).status).toBe(200);
    io.session.mockResolvedValue({ user: b });
    const denied = await readExam(req("/api/ospe/exam/record"), examParams);
    expect(denied.status).toBe(404); expect(await denied.json()).toEqual({ error: "exam not found" });
  });
});
