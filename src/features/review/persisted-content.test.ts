import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const io = vi.hoisted(() => ({ session: vi.fn(), entitled: vi.fn(), periods: vi.fn(),
  cards: vi.fn(), cases: vi.fn(), card: vi.fn(), case: vi.fn(), lecture: vi.fn(), bank: vi.fn(), execute: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/shared/session", () => ({ getSession: io.session }));
vi.mock("@/features/billing/queries", () => ({ hasModuleAccess: io.entitled }));
vi.mock("@/shared/db", () => ({ db: {
  select: () => ({ from: io.periods }),
  execute: io.execute,
  query: { flashcard: { findMany: io.cards, findFirst: io.card },
    clinicalCase: { findMany: io.cases, findFirst: io.case }, lecture: { findFirst: io.lecture },
    questionBank: { findFirst: io.bank } },
} }));

import { getAllFlashcards, getDueFlashcards, listMyCases, getAllClinicalCases, getClinicalCase } from "./queries";
import { getUserBattles } from "@/features/gamification/battles";

const dialect = new PgDialect();
const parameters = (where: SQL) => dialect.sqlToQuery(where).params;
const owner = { id: "student-a", role: "student" };
const scopes = ["visible", "paid", "year3", "year4", "year5", "future", "summer", "unmapped"];
const source = (id: string) => ({ id, title: `PRIVATE_${id}`, moduleId: id, module: {
  id, slug: id, isFree: id !== "paid", term: 1,
  studyYear: /^year[345]$/.test(id) ? Number(id.at(-1)) : id === "unmapped" ? 2 : 1,
  academicPeriodId: id === "unmapped" ? null : ["future", "summer"].includes(id) ? id : "current",
} });
const rows = scopes.flatMap(lectureId => [owner.id, "student-b"].map(userId => ({
  id: `${userId}-${lectureId}`, userId, lectureId, front: `PRIVATE_${lectureId}`,
  back: "stored answer", caseText: `PRIVATE_${lectureId}`, questionsJson: "[]", modelAnswersJson: "[]",
  dueDate: new Date("2026-10-01"), createdAt: new Date("2026-10-01"), lecture: source(lectureId),
})));
type Query = { where: SQL; columns?: Record<string, boolean>; limit?: number };
function findMany({ where, columns, limit }: Query) {
  const values = parameters(where);
  const userId = values.find(v => v === "student-a" || v === "student-b");
  const allowed = scopes.filter(id => values.includes(id));
  const selected = rows.filter(r => r.userId === userId && (!allowed.length || allowed.includes(r.lectureId)));
  return (limit ? selected.slice(0, limit) : selected).map(r => columns ? { lectureId: r.lectureId } : r);
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  io.session.mockResolvedValue({ user: owner }); io.entitled.mockResolvedValue(false);
  io.periods.mockResolvedValue([
    { id: "current", type: "TERM_1", active: true, startsAt: "2026-09-01 00:00:00", endsAt: "2027-01-01 00:00:00" },
    { id: "future", type: "TERM_2", active: true, startsAt: "2027-02-01 00:00:00", endsAt: "2027-06-01 00:00:00" },
    { id: "summer", type: "SUMMER", active: true, startsAt: "2026-07-01 00:00:00", endsAt: "2026-08-01 00:00:00" },
  ].map(period => ({ ...period, academicYear: "test-calendar" })));
  io.cards.mockImplementation(findMany); io.cases.mockImplementation(findMany);
  io.lecture.mockImplementation(({ where, columns }: Query) => {
    const id = parameters(where).find(v => typeof v === "string");
    return columns ? { id: "visible" } : scopes.includes(String(id)) ? source(String(id)) : null;
  });
  const one = ({ where }: Query) => rows.find(r => parameters(where).includes(r.id)) ?? null;
  io.card.mockImplementation(one); io.case.mockImplementation(one);
  io.bank.mockImplementation(({ where }: Query) => {
    const slug = String(parameters(where)[0]);
    return scopes.includes(slug) ? { id: slug, slug, module: source(slug).module } : null;
  });
  io.execute.mockResolvedValue(scopes.map(bank_slug => ({ id: bank_slug, bank_slug })));
});

describe("persisted challenge history", () => {
  it("does not disclose saved bank metadata after current access is lost", async () => {
    expect((await getUserBattles(owner.id)).map(r => r.bankSlug)).toEqual(["visible"]);
  });
  it("cannot impersonate another participant through the owner parameter", async () => {
    io.session.mockResolvedValue({ user: { id: "student-b" } });
    expect(await getUserBattles(owner.id)).toEqual([]); expect(io.execute).not.toHaveBeenCalled();
  });
  it("denies anonymous history before querying", async () => {
    io.session.mockResolvedValue(null);
    expect(await getUserBattles(owner.id)).toEqual([]); expect(io.execute).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.useRealTimers());

const lists = [["all cards", getAllFlashcards], ["due cards", getDueFlashcards],
  ["recent cases", listMyCases], ["all cases", getAllClinicalCases]] as const;
describe.each(lists)("persisted collection %s", (_name, list) => {
  it("owner list returns only currently accessible records, not another student's data", async () => {
    const result = await list(owner.id);
    expect(result.map(r => r.id)).toEqual(["student-a-visible"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_paid");
  });
  it.each(scopes.filter(s => s !== "visible"))("stored %s source remains hidden", async scope => {
    const result = await list(owner.id);
    expect(result.some(r => r.lectureId === scope)).toBe(false);
  });
  it("a changed userId parameter cannot retrieve A's list from B's session", async () => {
    io.session.mockResolvedValue({ user: { id: "student-b", role: "student" } });
    expect(await list(owner.id)).toEqual([]);
    expect(io.cards).not.toHaveBeenCalled(); expect(io.cases).not.toHaveBeenCalled();
  });
  it("anonymous caller receives no records", async () => {
    io.session.mockResolvedValue(null); expect(await list(owner.id)).toEqual([]);
    expect(io.cards).not.toHaveBeenCalled(); expect(io.cases).not.toHaveBeenCalled();
  });
  it("entitlement revocation is honored on the next read", async () => {
    io.entitled.mockResolvedValue(true);
    expect((await list(owner.id)).some(r => r.lectureId === "paid")).toBe(true);
    io.entitled.mockResolvedValue(false);
    expect((await list(owner.id)).some(r => r.lectureId === "paid")).toBe(false);
  });
  it("Admin's curriculum bypass does not grant another user's private collection", async () => {
    io.session.mockResolvedValue({ user: { id: "admin", role: "admin" } });
    expect(await list(owner.id)).toEqual([]);
  });
  it("Admin can read their OWN hidden-source records under existing policy", async () => {
    io.session.mockResolvedValue({ user: { ...owner, role: "admin" } });
    expect((await list(owner.id)).some(r => r.lectureId === "year5")).toBe(true);
  });
});

describe("stored case detail data access", () => {
  it("owner reads a visible case", async () => {
    expect(await getClinicalCase("student-a-visible", owner.id)).toMatchObject({ id: "student-a-visible" });
  });
  it("B cannot impersonate A using the function owner argument", async () => {
    io.session.mockResolvedValue({ user: { id: "student-b" } });
    expect(await getClinicalCase("student-a-visible", owner.id)).toBeUndefined();
  });
  it("owner cannot use another student's case ID", async () => {
    expect(await getClinicalCase("student-b-visible", owner.id)).toBeUndefined();
  });
  it.each(scopes.filter(s => s !== "visible"))("owner cannot read stored %s source", async scope => {
    expect(await getClinicalCase(`student-a-${scope}`, owner.id)).toBeUndefined();
  });
});
