/**
 * Deterministic weekly study plan.
 *
 * The basic schedule must never depend on AI: it is derived purely from
 * curriculum, progress and due reviews, so it is always available, free and
 * reproducible. AI may enrich the wording, never the plan itself.
 */

export type PlanItemKind = "LECTURE" | "FLASHCARDS" | "QUIZ" | "PRACTICAL" | "OSPE" | "REST";

export type PlanItem = {
  kind: PlanItemKind;
  title: string;
  /** Absolute route the student can follow, when the item is actionable. */
  href: string | null;
  /** Higher runs first inside a day. */
  priority: number;
  minutes: number;
  reason: string;
};

export type PlanDay = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  weekday: string;
  isToday: boolean;
  items: PlanItem[];
  totalMinutes: number;
};

export type WeeklyPlan = {
  days: PlanDay[];
  totalMinutes: number;
  /** True when there is genuinely nothing scheduled. */
  isEmpty: boolean;
  /** Human-readable reasons the plan is thin, instead of a blank screen. */
  notes: string[];
};

export type PlanLecture = {
  id: string;
  slug: string;
  title: string;
  moduleSlug: string;
  moduleTitle: string;
  completed: boolean;
};

export type WeeklyPlanInput = {
  /** Today as YYYY-MM-DD. Injected so the plan is deterministic in tests. */
  today: string;
  lectures: PlanLecture[];
  dueFlashcardCount: number;
  /** Modules the student can attempt a quiz for. */
  quizModules: Array<{ slug: string; title: string; hasQuiz: boolean }>;
  /** Modules with an approved practical bank. */
  practicalModules: Array<{ slug: string; title: string; questionCount: number }>;
  /** Minutes the student can study per day. */
  dailyMinutes?: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const weekdayOf = (iso: string): string => {
  const idx = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[idx] ?? "Day";
};

/**
 * Builds a 7-day plan.
 *
 * Ordering rules, in priority order:
 *  1. flashcards that are already due (they decay if ignored)
 *  2. the next unfinished lecture
 *  3. one quiz / practical attempt
 *  4. further lectures to fill the remaining daily budget
 */
export const buildWeeklyPlan = (input: WeeklyPlanInput): WeeklyPlan => {
  const dailyBudget = input.dailyMinutes ?? 45;
  const notes: string[] = [];

  const queue = input.lectures.filter((l) => !l.completed);
  if (!input.lectures.length) notes.push("No lectures are published for your year yet.");
  if (!input.dueFlashcardCount && !queue.length) notes.push("You are up to date — nothing is due and no lecture is unfinished.");
  if (input.lectures.length && !queue.length) notes.push("Every published lecture is complete.");
  if (!input.dueFlashcardCount && input.lectures.length) notes.push("No flashcards are due for review right now.");

  const days: PlanDay[] = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(input.today, i);
    const items: PlanItem[] = [];
    let used = 0;

    // 1. due flashcards — highest priority, they decay
    if (input.dueFlashcardCount > 0) {
      const minutes = Math.min(15, dailyBudget);
      items.push({
        kind: "FLASHCARDS",
        title: `Review ${input.dueFlashcardCount} due flashcard${input.dueFlashcardCount === 1 ? "" : "s"}`,
        href: "/flashcards",
        priority: 100,
        minutes,
        reason: "Due cards are scheduled for spaced repetition and lose value if deferred.",
      });
      used += minutes;
    }

    // 2. the very next unfinished lecture (removed from the queue, so it can
    // never be scheduled twice in the same week)
    const nextLecture = queue.shift();
    if (nextLecture && used < dailyBudget) {
      const minutes = Math.min(25, dailyBudget - used);
      items.push({
        kind: "LECTURE",
        title: nextLecture.title,
        href: `/lecture/${nextLecture.slug}`,
        priority: 90,
        minutes,
        reason: `Next unfinished lecture in ${nextLecture.moduleTitle}.`,
      });
      used += minutes;
    } else if (nextLecture) {
      // Budget already spent; put it back so it is not silently dropped.
      queue.unshift(nextLecture);
    }

    // 3. one assessment item, a few days into the week
    if (i === 2 || i === 4) {
      const practical = input.practicalModules.find((m) => m.questionCount > 0);
      const quiz = input.quizModules.find((m) => m.hasQuiz);
      const pick = practical ?? quiz;
      if (pick && used < dailyBudget) {
        const minutes = Math.min(20, dailyBudget - used);
        const isPractical = pick === practical;
        items.push({
          kind: isPractical ? "PRACTICAL" : "QUIZ",
          title: isPractical
            ? `Practical practice — ${(pick as { title: string }).title}`
            : `Quiz — ${(pick as { title: string }).title}`,
          href: isPractical ? `/curriculum/${pick.slug}/practical` : `/curriculum/${pick.slug}`,
          priority: 70,
          minutes,
          reason: isPractical ? "Retrieval practice on already-approved questions." : "Check understanding of the module you just studied.",
        });
        used += minutes;
      }
    }

    // 4. fill the remaining budget with later lectures
    while (used < dailyBudget && queue.length) {
      const l = queue.shift();
      if (!l || l.completed) continue;
      const minutes = Math.min(25, dailyBudget - used);
      items.push({
        kind: "LECTURE",
        title: l.title,
        href: `/lecture/${l.slug}`,
        priority: 50,
        minutes,
        reason: `Continue ${l.moduleTitle}.`,
      });
      used += minutes;
    }

    items.sort((a, b) => b.priority - a.priority);
    days.push({
      date,
      weekday: weekdayOf(date),
      isToday: i === 0,
      items,
      totalMinutes: items.reduce((s, x) => s + x.minutes, 0),
    });
  }

  const totalMinutes = days.reduce((s, d) => s + d.totalMinutes, 0);
  return { days, totalMinutes, isEmpty: days.every((d) => d.items.length === 0), notes };
};
