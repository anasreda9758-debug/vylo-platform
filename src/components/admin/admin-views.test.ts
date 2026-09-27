// Every admin tab must render against the REAL analytics payload shape, and
// must survive empty/zero data. A shape mismatch here is a broken tab in the
// owner's browser, so this is the contract guard for the whole Control Center.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ALL_PAYLOADS, ospePayload, practicalPayload, auditPayload, aiPayload, paymentsPayload } from "./__fixtures";
import { parseAdminDate, formatDate, toDateTimeLocalValue } from "./use-admin-data";

let current: unknown = null;
vi.mock("./use-admin-data", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, useAdminData: () => ({ data: current, loading: false, error: null, reload: () => {} }) };
});

import { OverviewTab } from "./overview";
import { UsersTab } from "./users";
import { SubscriptionsTab } from "./subscriptions";
import { ContentTab } from "./content";
import { LearningTab } from "./learning";
import { QuizTab } from "./quiz";
import { PracticalTab } from "./practical";
import { OspeTab } from "./ospe";
import { ReviewTab } from "./review";
import { AiTab } from "./ai";
import { XpTab } from "./xp";
import { ActivityTab } from "./activity";
import { PaymentsTab } from "./payments";
import { AuditTab } from "./audit";
import { SystemTab } from "./system";

const h = React.createElement;
const TABS: [string, React.ComponentType<Record<string, unknown>>, string, Record<string, unknown>][] = [
  ["Overview", OverviewTab as never, "overview", { onNavigate: () => {} }],
  ["Users", UsersTab as never, "users", { range: "30d" }],
  ["Subscriptions", SubscriptionsTab as never, "subscriptions", { range: "30d" }],
  ["Content Health", ContentTab as never, "content", { range: "30d" }],
  ["Learning", LearningTab as never, "learning", { range: "30d" }],
  ["Quiz", QuizTab as never, "quiz", { range: "30d" }],
  ["Practical", PracticalTab as never, "practical", { range: "30d" }],
  ["OSPE", OspeTab as never, "ospe", { range: "30d" }],
  ["Review", ReviewTab as never, "review", { range: "30d" }],
  ["AI", AiTab as never, "ai", { range: "30d" }],
  ["XP", XpTab as never, "xp", { range: "30d" }],
  ["Activity", ActivityTab as never, "activity", { range: "30d" }],
  ["Payments", PaymentsTab as never, "payments", { range: "30d" }],
  ["Audit", AuditTab as never, "audit", { range: "30d" }],
  ["System", SystemTab as never, "system", {}],
];

const render = (Comp: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown>) =>
  renderToStaticMarkup(h(Comp, props));

describe("every admin tab renders with the live payload contract", () => {
  for (const [name, Comp, view, props] of TABS) {
    it(`${name} renders (view=${view})`, () => {
      current = ALL_PAYLOADS[view];
      const html = render(Comp, props);
      expect(html.length).toBeGreaterThan(0);
    });
  }
});

describe("empty / zero-row data never crashes and never blocks", () => {
  // A tab fed empty collections must still settle into an empty state.
  const EMPTIES: Record<string, unknown> = {
    overview: {
      ...(ALL_PAYLOADS.overview as Record<string, unknown>),
      topModules: [], warnings: [],
      ai: { ...(ALL_PAYLOADS.overview as { ai: Record<string, unknown> }).ai, featureBreakdown: [] },
      payments: { enabled: false, byStatus: [] },
    },
    users: { users: [], total: 0, page: 1, limit: 25, filters: { role: null, studyYear: null } },
    subscriptions: { subscriptions: [], plans: [], total: 0, page: 1, limit: 25 },
    content: {
      curriculum: [], modules: [],
      lectures: { lectures: [], total: 0, page: 1, limit: 25 },
      range: "آخر 30 يوم",
    },
    learning: { days: [], totals: { lectures: 0, quizzes: 0, practical: 0, flashcards: 0, cases: 0 }, range: "آخر 30 يوم" },
    quiz: { summary: { total: 0, completed: 0, inProgress: 0, abandoned: 0, avgScorePct: 0 }, difficulty: [], perModule: [], range: "x" },
    practical: {
      tracks: [], trackTotal: 0, byStatus: [], byReview: [],
      submissions: { total: 0, users: 0 },
      progress: { attempts: 0, trackedRows: 0, difficult: 0, bookmarked: 0 }, range: "x",
    },
    ospe: { stationsConfigured: 0, answerKeyEntries: 0, answerKeyFolders: 0, exams: [], tracks: [], range: "x" },
    review: {
      flashcards: { total: 0, createdInRange: 0, dueNow: 0 },
      flashcardReviews: { reviews: 0, users: 0 }, mostDue: [],
      cases: { total: 0, lecturesCovered: 0, createdInRange: 0 },
      caseEvaluations: { total: 0, inRange: 0, users: 0, avgScore: 0 }, range: "x",
    },
    ai: {
      dailyLimit: 15, usedToday: 0, daily: [],
      buckets: { pct0: 0, pct25: 0, pct50: 0, pct75: 0, pct100: 0, unused: 0 },
      hosted: { calls: 0, inputTokens: 0, outputTokens: 0 },
      features: [], topUsers: [], tokens: { input: 0, output: 0 },
      groqConfigured: false, costPricingConfigured: false, range: "x",
    },
    xp: {
      totals: { totalXp: 0, profiles: 0, activeStreaks: 0, avgStreak: 0, battlesWon: 0, battlesLost: 0 },
      byReason: [], leaderboard: [], daily: [], todayUsers: [], range: "x",
    },
    activity: { events: [], range: "x" },
    payments: { enabled: false, byStatus: [], byMethod: [], range: "x" },
    audit: { logs: [], total: 0, page: 1, limit: 25, summary: [], recent: [], range: "x" },
    system: {
      time: { now: "2026-09-27T10:00:00.000Z", cairoDate: "2026-09-27" },
      env: { nodeEnv: "development", baseUrlSet: false },
      db: { connected: false, version: null, migrationCount: null },
      git: { commit: null, short: null, totalCommits: null },
      integrations: {
        ai: { groqKeySet: false, provider: null }, email: { resendKeySet: false },
        payments: { paymobApiKey: false, paymobIntegrationId: false, paymobHmac: false, enabled: false },
      },
      content: { rootSet: false, rootExists: false, imageFolders: null },
    },
  };

  for (const [name, Comp, view, props] of TABS) {
    it(`${name} renders with zero rows (view=${view})`, () => {
      current = EMPTIES[view];
      const html = render(Comp, props);
      expect(html.length).toBeGreaterThan(0);
      // Must never be a permanent spinner.
      expect(html).not.toContain("جاري التحميل");
    });
  }
});

describe("OSPE semantics: answer keys are not stations", () => {
  it("fixture keeps configured stations and answer-key entries distinct", () => {
    expect(ospePayload.stationsConfigured).toBe(0);
    expect(ospePayload.answerKeyEntries).toBe(759);
  });

  it("OSPE tab shows 0 configured stations and labels answer keys as reference data", () => {
    current = ospePayload;
    const html = render(OspeTab as never, { range: "30d" });
    // The zero-station empty state must be shown...
    expect(html).toContain("0 محطة مهيأة");
    // ...and the 759 answer keys must NOT be presented as the station count.
    expect(html).toContain("مفاتيح الإجابة المرجعية");
    expect(html).toContain("ليست محطات مهيأة");
  });
});

describe("Practical tolerates new source-grounded review statuses", () => {
  it("renders AUTO_VERIFIED_SOURCE alongside legacy statuses", () => {
    current = practicalPayload;
    const html = render(PracticalTab as never, { range: "30d" });
    expect(html).toContain("AUTO_VERIFIED_SOURCE");
    expect(html).toContain("DRAFT");
  });
});

describe("zero-count divisions and empty analytics", () => {
  it("AI tab renders the daily limit of 15 with zero usage", () => {
    current = aiPayload;
    const html = render(AiTab as never, { range: "30d" });
    expect(html).toContain("15");
  });

  it("Audit tab renders an empty state rather than inventing history", () => {
    current = auditPayload;
    const html = render(AuditTab as never, { range: "30d" });
    expect(html).toContain("لا توجد سجلات مطابقة");
  });

  it("Payments tab renders with payments disabled and zero rows", () => {
    current = paymentsPayload;
    const html = render(PaymentsTab as never, { range: "30d" });
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("admin timestamp handling", () => {
  it("parses the naive `timestamp without time zone` strings the API returns", () => {
    // These are the exact shapes observed from the live API.
    expect(parseAdminDate("2026-08-15 21:02:45.048")).toBeInstanceOf(Date);
    expect(parseAdminDate("2027-07-01T00:00:00.000Z")?.toISOString()).toBe("2027-07-01T00:00:00.000Z");
  });

  it("returns null for junk instead of an Invalid Date", () => {
    expect(parseAdminDate(null)).toBeNull();
    expect(parseAdminDate("")).toBeNull();
    expect(parseAdminDate("not-a-date")).toBeNull();
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("formats a datetime-local value in wall-clock, not raw UTC digits", () => {
    // Slicing an ISO string would yield "2027-07-01T00:00" from UTC digits and
    // shift the value by the browser offset once the control re-parses it.
    const out = toDateTimeLocalValue("2026-08-15 21:02:45.048");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(out.startsWith("2026-08-15")).toBe(true);
    expect(toDateTimeLocalValue(null)).toBe("");
  });
});
