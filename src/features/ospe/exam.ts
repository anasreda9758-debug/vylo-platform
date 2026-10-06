import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/shared/db";
import { ospeAnswerKey, ospeExam, ospeExamStation, ospeRubric, practicalTrackOspeStation } from "./schema";
import { rubricMaximum } from "./integrity";

/**
 * Create a new OSPE exam session.
 */
export async function createExam(params: {
  userId: string;
  practicalTrackId?: string | null;
  folder?: string | null;
  stationCount: number;
  timePerStationSec: number;
  totalTimeLimitSec: number;
}) {
  const examId = randomUUID();
  await db.insert(ospeExam).values({
    id: examId,
    userId: params.userId,
    practicalTrackId: params.practicalTrackId ?? null,
    folder: params.folder ?? null,
    stationCount: params.stationCount,
    timePerStationSec: params.timePerStationSec,
    totalTimeLimitSec: params.totalTimeLimitSec,
    status: "pending",
  });
  return examId;
}

/**
 * Start an exam: pick random stations and set status to in_progress.
 */
export async function startExam(examId: string, permittedFolders?: string[]) {
  const exam = await db.query.ospeExam.findFirst({
    where: eq(ospeExam.id, examId),
  });
  if (!exam) throw new Error("Exam not found");
  if (exam.status !== "pending") throw new Error("Exam already started");

  // Get all answer keys for the target folder(s)
  if (exam.folder && permittedFolders && !permittedFolders.includes(exam.folder)) {
    throw new Error("OSPE folder is not available");
  }
  const associatedKeys = exam.practicalTrackId
    ? await db.select({ answerKeyId: practicalTrackOspeStation.answerKeyId }).from(practicalTrackOspeStation)
      .where(eq(practicalTrackOspeStation.trackId, exam.practicalTrackId))
    : null;
  const folderFilter = exam.practicalTrackId
    ? inArray(ospeAnswerKey.id, associatedKeys!.map((row) => row.answerKeyId))
    : exam.folder
      ? eq(ospeAnswerKey.folder, exam.folder)
      : permittedFolders
        ? inArray(ospeAnswerKey.folder, permittedFolders)
        : undefined;

  if (exam.practicalTrackId && associatedKeys?.length === 0) throw new Error("No stations available for this practical subject");

  const allKeys = await db.query.ospeAnswerKey.findMany({
    where: folderFilter,
    orderBy: (k) => [asc(k.folder), asc(k.fileName)],
  });

  if (allKeys.length === 0) throw new Error("No stations available for this folder");

  // Shuffle and pick
  const shuffled = [...allKeys].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(exam.stationCount, shuffled.length));

  // Create exam stations
  for (let i = 0; i < picked.length; i++) {
    await db.insert(ospeExamStation).values({
      id: randomUUID(),
      examId,
      order: i,
      folder: picked[i].folder,
      fileName: picked[i].fileName,
      answerKeyId: picked[i].id,
    });
  }

  // Update exam status
  await db
    .update(ospeExam)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(ospeExam.id, examId));

  return {
    examId,
    stationCount: picked.length,
    totalTimeLimitSec: exam.totalTimeLimitSec,
    timePerStationSec: exam.timePerStationSec,
  };
}

/**
 * Get exam with all stations for display.
 */
export async function getExam(examId: string, userId: string) {
  return db.query.ospeExam.findFirst({
    where: and(eq(ospeExam.id, examId), eq(ospeExam.userId, userId)),
    with: {
      stations: {
        orderBy: (s) => [asc(s.order)],
      },
    },
  });
}

/**
 * Submit an answer for a single station.
 */
export async function submitStationAnswer(params: {
  examId: string;
  stationId: string;
  userId: string;
  studentAnswer: string;
  timeSpentSec: number;
}) {
  // Verify the exam belongs to the user and is in progress
  const exam = await db.query.ospeExam.findFirst({
    where: and(eq(ospeExam.id, params.examId), eq(ospeExam.userId, params.userId)),
  });
  if (!exam || exam.status !== "in_progress") {
    throw new Error("Exam not in progress");
  }

  // Score the answer (simple keyword matching for now)
  const station = await db.query.ospeExamStation.findFirst({
    where: and(
      eq(ospeExamStation.id, params.stationId),
      eq(ospeExamStation.examId, params.examId),
    ),
  });
  if (!station) throw new Error("Station not found");

  let score = 0;
  let maxScore = 0;

  if (station.answerKeyId) {
    const rubrics = await db.query.ospeRubric.findMany({
      where: eq(ospeRubric.answerKeyId, station.answerKeyId),
      orderBy: (r) => [asc(r.order)],
    });

    const answerLower = params.studentAnswer.toLowerCase();
    for (const r of rubrics) {
      maxScore += r.maxPoints;
      // Simple keyword match: check if the criterion keywords appear in the answer
      const criterionWords = r.criterion.toLowerCase().split(/\s+/);
      const matchCount = criterionWords.filter((w) => w.length > 2 && answerLower.includes(w)).length;
      if (matchCount >= Math.ceil(criterionWords.length * 0.4)) {
        score += r.maxPoints;
      }
    }
  }

  await db
    .update(ospeExamStation)
    .set({
      studentAnswer: params.studentAnswer,
      score,
      timeSpentSec: params.timeSpentSec,
      answeredAt: new Date(),
    })
    .where(eq(ospeExamStation.id, params.stationId));

  return { score, maxScore };
}

/**
 * Finish an exam: calculate total score and mark complete.
 */
export async function finishExam(examId: string, userId: string) {
  const exam = await db.query.ospeExam.findFirst({
    where: and(eq(ospeExam.id, examId), eq(ospeExam.userId, userId)),
    with: { stations: true },
  });
  if (!exam || exam.status !== "in_progress") {
    throw new Error("Exam not in progress");
  }

  const totalScore = exam.stations.reduce((sum, s) => sum + (s.score ?? 0), 0);
  const keyIds = [...new Set(exam.stations.flatMap((s) => s.answerKeyId ? [s.answerKeyId] : []))];
  const rubrics = keyIds.length ? await db.query.ospeRubric.findMany({ where: inArray(ospeRubric.answerKeyId, keyIds) }) : [];
  const maxPossibleScore = rubricMaximum(exam.stations, rubrics);

  await db
    .update(ospeExam)
    .set({
      status: "completed",
      completedAt: new Date(),
      totalScore,
      maxPossibleScore,
    })
    .where(eq(ospeExam.id, examId));

  return { totalScore, maxPossibleScore, percentage: maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0,
    stations: exam.stations.map((s) => ({ id: s.id, score: s.score ?? 0 })) };
}

/**
 * Get exam history for a user.
 */
export async function getExamHistory(userId: string, limit = 20) {
  return db.query.ospeExam.findMany({
    where: and(eq(ospeExam.userId, userId), eq(ospeExam.status, "completed")),
    orderBy: (e) => [desc(e.completedAt)],
    limit,
  });
}

/**
 * Admin: Create an answer key for a station.
 */
export async function upsertAnswerKey(params: {
  folder: string;
  fileName: string;
  diagnosis: string;
  identification?: string;
  findings?: string;
  differential?: string;
  management?: string;
}) {
  // Check if exists
  const existing = await db.query.ospeAnswerKey.findFirst({
    where: and(
      eq(ospeAnswerKey.folder, params.folder),
      eq(ospeAnswerKey.fileName, params.fileName),
    ),
  });

  if (existing) {
    await db
      .update(ospeAnswerKey)
      .set({
        diagnosis: params.diagnosis,
        identification: params.identification ?? null,
        findings: params.findings ?? null,
        differential: params.differential ?? null,
        management: params.management ?? null,
      })
      .where(eq(ospeAnswerKey.id, existing.id));
    return existing.id;
  }

  const id = randomUUID();
  await db.insert(ospeAnswerKey).values({
    id,
    folder: params.folder,
    fileName: params.fileName,
    diagnosis: params.diagnosis,
    identification: params.identification ?? null,
    findings: params.findings ?? null,
    differential: params.differential ?? null,
    management: params.management ?? null,
  });
  return id;
}

/**
 * Admin: Add rubric criteria to an answer key.
 */
export async function setRubrics(answerKeyId: string, rubrics: { criterion: string; maxPoints: number }[]) {
  // Delete existing
  await db.delete(ospeRubric).where(eq(ospeRubric.answerKeyId, answerKeyId));

  // Insert new
  for (let i = 0; i < rubrics.length; i++) {
    await db.insert(ospeRubric).values({
      id: randomUUID(),
      answerKeyId,
      criterion: rubrics[i].criterion,
      maxPoints: rubrics[i].maxPoints,
      order: i,
    });
  }
}
