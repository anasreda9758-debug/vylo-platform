import { describe, expect, it, vi } from "vitest";
import { rubricMaximum, saveOspeAnswer, studentExam } from "./integrity";

const station = { id: "s", order: 0, folder: "RENAL", fileName: "station.png", studentAnswer: "own answer", timeSpentSec: 10, score: 4, answerKeyId: "secret-key", explanation: "secret", rubric: [{ result: 1 }] };
const exam = { id: "exam", status: "in_progress", stationCount: 1, timePerStationSec: 60, totalTimeLimitSec: 60, startedAt: new Date(), totalScore: 4, maxPossibleScore: 7, stations: [station] };

describe("OSPE integrity", () => {
  it("removes scores, answer-key IDs and explanations from active exams", () => {
    const result = studentExam(exam);
    expect(result).not.toHaveProperty("totalScore"); expect(result).not.toHaveProperty("maxPossibleScore");
    for (const field of ["score", "answerKeyId", "explanation", "rubric"]) expect(result.stations[0]).not.toHaveProperty(field);
  });
  it("returns scores only after completion", () => {
    const result = studentExam({ ...exam, status: "completed" });
    expect(result.totalScore).toBe(4); expect(result.stations[0].score).toBe(4);
    expect(result.stations[0]).not.toHaveProperty("answerKeyId");
  });
  it("uses all actual rubric totals, including unanswered stations, instead of stations times ten", () => {
    expect(rubricMaximum([{ answerKeyId: "a" }, { answerKeyId: "b" }, { answerKeyId: null }], [{ answerKeyId: "a", maxPoints: 2 }, { answerKeyId: "a", maxPoints: 3 }, { answerKeyId: "b", maxPoints: 4 }])).toBe(9);
    expect(rubricMaximum([], [])).toBe(0);
  });
  it("waits for confirmed persistence before the caller can advance", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((r) => { resolve = r; }));
    const advance = vi.fn();
    const saving = saveOspeAnswer(fetcher, "/exam", { stationId: "s", answer: "answer", timeSpentSec: 2 }).then(advance);
    expect(advance).not.toHaveBeenCalled();
    resolve(Response.json({ ok: true, saved: true, stationId: "s" }));
    await saving; expect(advance).toHaveBeenCalledOnce();
  });
  it.each([Response.json({ ok: false }, { status: 500 }), Response.json({ ok: true }), Response.json({ ok: true, saved: true, stationId: "other" })])("does not advance on a failed or mismatched save", async (response) => {
    const advance = vi.fn();
    await expect(saveOspeAnswer(vi.fn<typeof fetch>().mockResolvedValue(response), "/exam", { stationId: "s", answer: "a", timeSpentSec: 1 }).then(advance)).rejects.toThrow();
    expect(advance).not.toHaveBeenCalled();
  });
});
