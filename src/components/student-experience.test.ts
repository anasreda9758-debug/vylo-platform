import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ModuleList,
  ModuleLectures,
  ModuleContinuation,
  type StudyModule,
} from "./module-experience";
import { StudyWorkspace } from "./study-workspace";
import { StudentNavigation, primaryStudentLinks } from "./student-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/curriculum",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({}),
}));
vi.mock("./preference-controls", () => ({ PreferenceControls: () => null }));
vi.mock("./sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("./complete-button", () => ({
  CompleteButton: () => createElement("button", null, "Mark complete"),
}));
const lecture = {
  id: "lecture",
  slug: "lecture",
  title: "A long learning topic",
  subject: "Anatomy",
  kind: "lecture",
  completed: false,
  durationMin: 20,
};
const mod: StudyModule = {
  id: "module",
  slug: "module",
  name: "Module",
  studyYear: 1,
  term: 1,
  totalLectures: 1,
  completedLectures: 0,
  percent: 0,
  access: true,
  lectures: [lecture],
};
const html = <P extends object>(component: ComponentType<P>, props: P) =>
  renderToStaticMarkup(createElement(component, props));

describe("student navigation", () => {
  it("keeps six primary destinations and secondary tools available", () => {
    expect(primaryStudentLinks).toHaveLength(6);
    const markup = html(StudentNavigation, {
      user: { name: "Student", email: "test@example.invalid" },
      isAdmin: false,
    });
    for (const label of [
      "Home",
      "Modules",
      "Study Plan",
      "Question Bank",
      "Flashcards",
      "AI Tutor",
      "More tools",
    ])
      expect(markup).toContain(label);
    expect(markup).toContain('href="/ospe"');
    expect(markup).toContain('href="/cases"');
    expect(markup).not.toContain('href="/admin"');
  });
  it("provides labeled mobile dialog, skip link and active navigation", () => {
    const markup = html(StudentNavigation, {
      user: { name: "Student", email: "test@example.invalid" },
      isAdmin: false,
    });
    expect(markup).toContain("Open navigation");
    expect(markup).toContain("<dialog");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('href="#student-main"');
    expect(markup).toContain('aria-current="page"');
  });
});
describe("module states", () => {
  it("shows a real continuation and progress for an accessible module", () => {
    const markup = html(ModuleList, { modules: [mod], locale: "en" });
    expect(markup).toContain('href="/lecture/lecture"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain("Year 1 · Term 1");
  });
  it("does not advertise empty content as locked or payable", () => {
    const markup = html(ModuleList, {
      modules: [{ ...mod, access: false, totalLectures: 0, lectures: [] }],
      locale: "en",
    });
    expect(markup).toContain("Coming soon");
    expect(markup).not.toContain("Locked");
    expect(markup).not.toContain('href="/pricing"');
  });
  it("does not offer direct continuation for locked modules", () => {
    const markup = html(ModuleList, {
      modules: [{ ...mod, access: false }],
      locale: "en",
    });
    expect(markup).toContain("Locked");
    expect(markup).not.toContain('href="/lecture/lecture"');
  });
  it("retains completed/current states and contextual tutor destination", () => {
    const markup = html(ModuleLectures, {
      lectures: [{ ...lecture, id: "done", completed: true }, lecture],
      moduleSlug: "module",
      locale: "en",
      tool: "tutor",
    });
    expect(markup).toContain("Completed");
    expect(markup).toContain("Current");
    expect(markup).toContain('href="/lecture/lecture?tool=tutor"');
  });
  it("has no fabricated CTA after all lectures are complete", () => {
    const markup = html(ModuleContinuation, { lecture: null, locale: "en" });
    expect(markup).toContain("completed this module");
    expect(markup).not.toContain("href=");
  });
});
describe("study workspace", () => {
  const panels = [
    { id: "source", label: "Source", content: "Source content" },
    { id: "notes", label: "Notes", content: "Private notes" },
  ];
  it("keeps material primary with associated tabs and lazy inactive tools", () => {
    const markup = html(StudyWorkspace, { material: "PDF reader", panels });
    expect(markup).toContain("PDF reader");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-controls="tool-panel-source"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain("Private notes");
  });
  it("honors a supported initial tool and safely falls back for unknown tools", () => {
    expect(
      html(StudyWorkspace, { material: "PDF", panels, initialPanel: "notes" }),
    ).toContain("Private notes");
    expect(
      html(StudyWorkspace, {
        material: "PDF",
        panels,
        initialPanel: "invalid",
      }),
    ).toContain("Source content");
  });
});
