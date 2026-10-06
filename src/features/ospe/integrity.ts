type Station = { id: string; order: number; folder: string; fileName: string; studentAnswer: string | null; timeSpentSec: number | null; score: number | null };
type Exam = { id: string; status: string; stationCount: number; totalTimeLimitSec: number; timePerStationSec: number; startedAt: Date | null; totalScore: number | null; maxPossibleScore: number | null; stations: Station[] };

/** Allowlist for every exam response, including creation and resume. */
export function studentExam(exam: Exam) {
  const finished = exam.status === "completed" || exam.status === "timed_out";
  return {
    id: exam.id, examId: exam.id, status: exam.status, stationCount: exam.stations.length,
    totalTimeLimitSec: exam.totalTimeLimitSec, timePerStationSec: exam.timePerStationSec, startedAt: exam.startedAt,
    ...(finished ? { totalScore: exam.totalScore, maxPossibleScore: exam.maxPossibleScore } : {}),
    stations: exam.stations.map((s) => ({ id: s.id, order: s.order, folder: s.folder, fileName: s.fileName,
      studentAnswer: s.studentAnswer, timeSpentSec: s.timeSpentSec, ...(finished ? { score: s.score } : {}),
    })),
  };
}
export function rubricMaximum(stations: { answerKeyId: string | null }[], rubrics: { answerKeyId: string; maxPoints: number }[]) {
  return stations.reduce((total, station) => total + rubrics.filter((r) => r.answerKeyId === station.answerKeyId).reduce((n, r) => n + r.maxPoints, 0), 0);
}

/** A resolved fetch is NOT an acknowledgement. Never advance on HTTP/application failure. */
export async function saveOspeAnswer(fetcher: typeof fetch, url: string, body: { stationId: string; answer: string; timeSpentSec: number }) {
  const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", ...body }) });
  if (!response.ok) throw new Error("Answer was not saved. Please retry this station.");
  const result = await response.json();
  if (result.ok !== true || result.saved !== true || result.stationId !== body.stationId) throw new Error("Answer save was not confirmed. Please retry this station.");
}
