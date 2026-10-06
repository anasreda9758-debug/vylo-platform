import { describe, expect, it } from "vitest";
import { buildWeeklyPlan, type PlanLecture, type WeeklyPlanInput } from "./weeklyPlan";

const lecture = (n: number, completed = false): PlanLecture => ({
  id: `l${n}`,
  slug: `lecture-${n}`,
  title: `Lecture ${n}`,
  moduleSlug: "m1",
  moduleTitle: "Module 1",
  completed,
});

const base = (over: Partial<WeeklyPlanInput> = {}): WeeklyPlanInput => ({
  today: "2026-03-02", // a Monday
  lectures: [lecture(1), lecture(2), lecture(3)],
  dueFlashcardCount: 0,
  quizModules: [],
  practicalModules: [],
  ...over,
});

describe("weekly plan", () => {
  it("always returns exactly 7 days", () => {
    const p = buildWeeklyPlan(base());
    expect(p.days).toHaveLength(7);
    expect(p.days[0].date).toBe("2026-03-02");
    expect(p.days[6].date).toBe("2026-03-08");
    expect(p.days[0].isToday).toBe(true);
    expect(p.days.filter((d) => d.isToday)).toHaveLength(1);
  });

  it("is deterministic", () => {
    expect(buildWeeklyPlan(base())).toEqual(buildWeeklyPlan(base()));
  });

  it("puts due flashcards first on every day they apply", () => {
    const p = buildWeeklyPlan(base({ dueFlashcardCount: 12 }));
    const first = p.days[0].items[0];
    expect(first.kind).toBe("FLASHCARDS");
    expect(first.priority).toBe(100);
  });

  it("schedules the next unfinished lecture before later lectures", () => {
    const p = buildWeeklyPlan(base());
    const lectureItems = p.days.flatMap((d) => d.items.filter((i) => i.kind === "LECTURE"));
    expect(lectureItems[0].title).toBe("Lecture 1");
  });

  it("never repeats a lecture across the week", () => {
    const p = buildWeeklyPlan(base({ lectures: [lecture(1), lecture(2), lecture(3), lecture(4), lecture(5), lecture(6), lecture(7), lecture(8)] }));
    const titles = p.days.flatMap((d) => d.items.filter((i) => i.kind === "LECTURE").map((i) => i.title));
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("skips completed lectures", () => {
    const p = buildWeeklyPlan(base({ lectures: [lecture(1, true), lecture(2), lecture(3)] }));
    const titles = p.days.flatMap((d) => d.items.map((i) => i.title));
    expect(titles).not.toContain("Lecture 1");
    expect(titles).toContain("Lecture 2");
  });

  it("respects the daily minute budget", () => {
    const p = buildWeeklyPlan(base({ dueFlashcardCount: 30, dailyMinutes: 45 }));
    for (const d of p.days) expect(d.totalMinutes).toBeLessThanOrEqual(45);
  });

  it("adds a practical suggestion when approved questions exist", () => {
    const p = buildWeeklyPlan(base({ practicalModules: [{ slug: "m1", title: "Module 1", questionCount: 40 }] }));
    const items = p.days.flatMap((d) => d.items);
    expect(items.some((i) => i.kind === "PRACTICAL")).toBe(true);
  });

  it("falls back to a quiz when no practical bank exists", () => {
    const p = buildWeeklyPlan(base({ quizModules: [{ slug: "m1", title: "Module 1", hasQuiz: true }] }));
    expect(p.days.flatMap((d) => d.items).some((i) => i.kind === "QUIZ")).toBe(true);
  });

  it("is a truthful empty state with notes, never a blank screen", () => {
    const p = buildWeeklyPlan(base({ lectures: [lecture(1, true), lecture(2, true)], dueFlashcardCount: 0 }));
    expect(p.isEmpty).toBe(true);
    expect(p.notes.length).toBeGreaterThan(0);
    expect(p.notes.join(" ")).toMatch(/up to date|complete/i);
  });

  it("explains a missing-curriculum state", () => {
    const p = buildWeeklyPlan(base({ lectures: [] }));
    expect(p.notes.join(" ")).toMatch(/No lectures are published/);
  });

  it("every actionable item links somewhere", () => {
    const p = buildWeeklyPlan(base({ dueFlashcardCount: 3, practicalModules: [{ slug: "m1", title: "M1", questionCount: 5 }] }));
    for (const d of p.days) for (const i of d.items) expect(i.href).toBeTruthy();
  });

  it("does not require AI: identical input yields identical output offline", () => {
    const input = base({ dueFlashcardCount: 4 });
    const a = buildWeeklyPlan(input);
    const b = buildWeeklyPlan({ ...input });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
