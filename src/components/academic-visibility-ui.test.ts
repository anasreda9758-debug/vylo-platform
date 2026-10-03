import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DashboardHome } from "./dashboard-home";
import { ModuleList, type StudyModule } from "./module-experience";
import { AcademicYearSelector } from "./academic-year-selector";
import { buildAcademicVisibility, filterAcademicModules, type AcademicWindow } from "@/features/hierarchy/academic-visibility";
vi.mock("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => "/curriculum", useSearchParams: () => new URLSearchParams() }));
vi.mock("./complete-button", () => ({ CompleteButton: () => null }));
const periods: AcademicWindow[] = [
  { id: "t1", academicYear: "2026-2027", type: "TERM_1", startsAt: "2026-09-01T00:00", endsAt: "2027-02-28T23:59", active: true },
  { id: "t2", academicYear: "2026-2027", type: "TERM_2", startsAt: "2027-03-01T00:00", endsAt: "2027-06-30T23:59", active: true },
  { id: "s", academicYear: "2026-2027", type: "SUMMER", startsAt: "2027-07-01T00:00", endsAt: "2027-09-15T23:59", active: true },
];
const modules: (StudyModule & { academicPeriodId: string })[] = periods.map((p, index) => ({
  id: p.id, slug: p.id, academicPeriodId: p.id, name: ["Current Term One Module", "Current Term Two Module", "Summer Module"][index],
  term: index + 1, studyYear: index === 1 ? 2 : 1, totalLectures: 1, completedLectures: 0, percent: 0, access: true,
  lectures: [{ id: `l-${p.id}`, slug: `l-${p.id}`, title: `Lecture for ${p.id}`, subject: "Anatomy", kind: "lecture", durationMin: 20, completed: false }],
}));

describe("actual student UI with controlled academic dates (no database/clock changes)", () => {
  it.each([
    ["term1", "2026-10-03T12:00:00Z", "t1"],
    ["term2", "2027-04-03T12:00:00Z", "t2"],
    ["summer", "2027-08-03T12:00:00Z", "s"],
  ])("renders Dashboard/Modules/year selector for %s", (name, timestamp, id) => {
    const visibility = buildAcademicVisibility(periods, new Date(timestamp));
    const current = filterAcademicModules(modules, visibility, "student", true);
    const history = filterAcademicModules(modules, visibility);
    const years = [...new Set(current.map((m) => m.studyYear))];
    const next = current[0].lectures[0];
    const dashboard = renderToStaticMarkup(createElement(DashboardHome, {
      name: "Local QA", locale: "en", years, year: years[0], modules: current,
      nextLecture: { ...next, moduleName: current[0].name }, due: 0, completed: 0, total: 1, percent: 0,
      accuracy: null, score: 0, level: 1, xp: 0, weakModule: null, recent: [], terms: [], subscriptions: [],
    }));
    const curriculum = renderToStaticMarkup(createElement(ModuleList, { modules: history, locale: "en" }));
    const selector = renderToStaticMarkup(createElement(AcademicYearSelector, { years: [...new Set(history.map((m) => m.studyYear))], value: years[0] }));
    expect(dashboard).toContain(`href="/lecture/l-${id}"`);
    expect(dashboard).toContain(current[0].name);
    for (const other of modules.filter((m) => m.id !== id)) expect(dashboard).not.toContain(other.name);
    for (const hidden of modules.filter((m) => !visibility.visiblePeriodIds.has(m.id))) expect(curriculum).not.toContain(hidden.name);
    if (name === "term1") expect(selector).not.toContain("Academic year 2");
    if (process.env.ACADEMIC_QA_RENDER === "1") {
      mkdirSync("tmp/academic-visibility-qa", { recursive: true });
      writeFileSync(`tmp/academic-visibility-qa/${name}.html`, `${dashboard}<section class="mx-auto max-w-6xl p-5"><h1>Modules (${name})</h1>${selector}${curriculum}</section>`);
    }
  });
});
