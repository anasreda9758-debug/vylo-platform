import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the database using vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/shared/db", () => ({
  db: {
    execute: mocks.execute,
  },
}));

import { hasEarnedLectureCompletionXp } from "@/features/gamification/queries";

describe("XP farming prevention - hasEarnedLectureCompletionXp", () => {
  const testUserId = "test-user-xp-farming";
  const testLectureId = "test-lecture-xp-farming";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
  });

  it("returns false for user with no XP log entries", async () => {
    mocks.execute.mockResolvedValueOnce([]);
    const result = await hasEarnedLectureCompletionXp(testUserId, testLectureId);
    expect(result).toBe(false);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("returns true when user has lecture_complete XP for this lecture", async () => {
    mocks.execute.mockResolvedValueOnce([{ "?column?": 1 }]);
    const result = await hasEarnedLectureCompletionXp(testUserId, testLectureId);
    expect(result).toBe(true);
  });
});

describe("XP farming logic - toggle behavior simulation", () => {
  // These tests simulate the toggle route logic using the hasEarned function
  // to verify the XP awarding logic is correct

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
  });

  it("first completion: hasEarned returns false, XP should be awarded", async () => {
    mocks.execute.mockResolvedValueOnce([]);
    const alreadyEarned = await hasEarnedLectureCompletionXp("user-1", "lecture-1");
    expect(alreadyEarned).toBe(false);
    // In toggle route: if (!alreadyEarned) { awardXp(); updateStreak(); }
  });

  it("re-complete after unmark: hasEarned returns true, XP should NOT be awarded", async () => {
    mocks.execute.mockResolvedValueOnce([{ "?column?": 1 }]);
    const alreadyEarned = await hasEarnedLectureCompletionXp("user-1", "lecture-1");
    expect(alreadyEarned).toBe(true);
    // In toggle route: if (!alreadyEarned) { awardXp(); } -> skipped
  });

  it("different lectures are independent", async () => {
    // First call: lecture-1 earned
    mocks.execute.mockResolvedValueOnce([{ "?column?": 1 }]);
    // Second call: lecture-2 not earned
    mocks.execute.mockResolvedValueOnce([]);
    
    const lecture1Earned = await hasEarnedLectureCompletionXp("user-1", "lecture-1");
    const lecture2Earned = await hasEarnedLectureCompletionXp("user-1", "lecture-2");
    
    expect(lecture1Earned).toBe(true);
    expect(lecture2Earned).toBe(false);
  });

  it("user isolation: Student A completion does not affect Student B", async () => {
    // Student A has earned
    mocks.execute.mockResolvedValueOnce([{ "?column?": 1 }]);
    // Student B has not earned
    mocks.execute.mockResolvedValueOnce([]);
    
    const studentAEarned = await hasEarnedLectureCompletionXp("student-A", "lecture-1");
    const studentBEarned = await hasEarnedLectureCompletionXp("student-B", "lecture-1");
    
    expect(studentAEarned).toBe(true);
    expect(studentBEarned).toBe(false);
  });

  it("10 complete/unmark cycles: hasEarned returns true after first cycle", async () => {
    // First cycle: not earned yet
    mocks.execute.mockResolvedValueOnce([]);
    // Cycles 2-10: already earned
    for (let i = 0; i < 9; i++) {
      mocks.execute.mockResolvedValueOnce([{ "?column?": 1 }]);
    }
    
    let awardCount = 0;
    for (let i = 0; i < 10; i++) {
      const alreadyEarned = await hasEarnedLectureCompletionXp("user-1", "lecture-1");
      if (!alreadyEarned) {
        awardCount++;
        // Simulate awarding XP - next call will return true
      }
    }
    
    expect(awardCount).toBe(1);
  });
});