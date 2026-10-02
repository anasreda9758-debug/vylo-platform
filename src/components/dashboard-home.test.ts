import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DashboardHome } from "./dashboard-home";

vi.mock("@/components/academic-year-selector", () => ({ AcademicYearSelector: () => null }));
vi.mock("@/components/weekly-plan-card", () => ({ default: () => createElement("p", null, "Existing weekly plan") }));

const baseline = {
  name: "Student", years: [1, 2], year: 1, locale: "en" as const,
  nextLecture: null, modules: [], due: 0, completed: 0, total: 0, percent: 0,
  accuracy: null, score: 0, level: 1, xp: 0, weakModule: null, recent: [],
  terms: [{ term: 10, percent: 0, hasContent: false, completedLectures: 0, totalLectures: 0 }], subscriptions: [],
};

describe("Dashboard study home", () => {
  it("offers a curriculum start for empty learners without inventing due work or populated terms", () => {
    const html = renderToStaticMarkup(createElement(DashboardHome, baseline));
    expect(html).toContain("Choose your next lecture");
    expect(html).toContain('href="/curriculum"');
    expect(html).toContain("No modules are available");
    expect(html).not.toContain("Term 10");
    expect(html).not.toContain("Review 10");
    expect(html).not.toContain("Exam readiness");
    expect(html).toContain("not a prediction of exam performance");
  });

  it("keeps lecture, due review, weakest module and locked-module navigation distinct", () => {
    const html = renderToStaticMarkup(createElement(DashboardHome, {
      ...baseline,
      nextLecture: { title: "Renal development", slug: "renal-development", moduleName: "Renal", durationMin: 25 },
      due: 3, weakModule: { moduleName: "Respiratory", moduleSlug: "resp" },
      modules: [{ name: "Renal", slug: "renal", completedLectures: 1, totalLectures: 10, percent: 10, access: false }],
    }));
    expect(html).toContain('href="/lecture/renal-development"');
    expect(html).toContain('href="/review"');
    expect(html).toContain('href="/curriculum/resp"');
    expect(html).toContain('href="/curriculum/renal"');
    expect(html).toContain("Locked");
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain("3 questions due for review");
  });

  it("preserves activity and weekly-plan content while keeping secondary sections collapsible", () => {
    const html = renderToStaticMarkup(createElement(DashboardHome, {
      ...baseline,
      accuracy: 80, score: 41,
      recent: [{ id: "attempt", bankTitle: "Renal quiz", moduleName: "Renal", score: 4, total: 5, completedAt: null }],
    }));
    expect(html).toContain("Renal quiz");
    expect(html).toContain("4/5");
    expect(html).toContain("Existing weekly plan");
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
  });
});
