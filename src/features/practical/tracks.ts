import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/shared/db";
import { getAccessibleModuleBySlug, type LearningActor } from "@/features/access/learning-access";
import { practicalQuestion, practicalProgress, practicalTrack } from "./schema";
import { practicalTrackOspeStation } from "@/features/ospe/schema";
import type { PracticalSummary, PracticalTrackResolution, ResolvedPracticalTrack } from "./model";

function resolvedTrack(
  row: typeof practicalTrack.$inferSelect,
  module: { id: string; slug: string; name: string; studyYear: number },
): ResolvedPracticalTrack {
  return {
    ...row,
    moduleId: module.id,
    moduleSlug: module.slug,
    moduleName: module.name,
    studyYear: module.studyYear,
  };
}

export async function resolvePracticalTrack(
  actor: LearningActor | null | undefined,
  moduleSlug: string,
  subjectSlug: string,
  includeDraft = false,
): Promise<PracticalTrackResolution> {
  const access = await getAccessibleModuleBySlug(actor, moduleSlug);
  if (!access.ok) return access;
  const [track] = await db.select().from(practicalTrack).where(and(
    eq(practicalTrack.moduleId, access.value.id),
    eq(practicalTrack.subjectSlug, subjectSlug),
    includeDraft ? ne(practicalTrack.status, "ARCHIVED") : eq(practicalTrack.status, "PUBLISHED"),
  )).limit(1);
  if (!track) return { ok: false, reason: "not_found" };
  return { ok: true, value: resolvedTrack(track, access.value) };
}

export async function resolvePracticalTrackById(
  actor: LearningActor | null | undefined,
  trackId: string,
  requirePublished = true,
): Promise<PracticalTrackResolution> {
  const [row] = await db.select({ track: practicalTrack, module: {
    id: practicalTrack.moduleId,
  } }).from(practicalTrack).where(and(
    eq(practicalTrack.id, trackId),
    requirePublished ? eq(practicalTrack.status, "PUBLISHED") : ne(practicalTrack.status, "ARCHIVED"),
  )).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  const moduleAccess = await db.query.curriculumModule.findFirst({ where: (module, { eq: equal }) => equal(module.id, row.track.moduleId) });
  if (!moduleAccess) return { ok: false, reason: "not_found" };
  const access = await getAccessibleModuleBySlug(actor, moduleAccess.slug);
  if (!access.ok) return access;
  return { ok: true, value: resolvedTrack(row.track, access.value) };
}

export async function listPracticalTracks(
  actor: LearningActor | null | undefined,
  moduleSlug: string,
  includeDraft = false,
) {
  const access = await getAccessibleModuleBySlug(actor, moduleSlug);
  if (!access.ok) return { access, tracks: [] as ResolvedPracticalTrack[] };
  const rows = await db.select().from(practicalTrack).where(and(
    eq(practicalTrack.moduleId, access.value.id),
    includeDraft ? ne(practicalTrack.status, "ARCHIVED") : eq(practicalTrack.status, "PUBLISHED"),
  )).orderBy(asc(practicalTrack.sortOrder), asc(practicalTrack.displayNameEn));
  return { access, tracks: rows.map((row) => resolvedTrack(row, access.value)) };
}

export type PracticalTrackDashboardItem = ResolvedPracticalTrack & {
  summary: PracticalSummary;
  ospeStationCount: number;
};

export async function getPracticalTrackDashboard(userId: string, tracks: ResolvedPracticalTrack[]): Promise<PracticalTrackDashboardItem[]> {
  if (!tracks.length) return [];
  const ids = tracks.map((track) => track.id);
  const progressRows = await db.select({
    trackId: practicalQuestion.trackId,
    attempts: practicalProgress.attempts,
    correct: practicalProgress.correct,
    wrong: practicalProgress.wrong,
    wrongRemaining: practicalProgress.wrongRemaining,
  }).from(practicalQuestion).leftJoin(practicalProgress, and(
    eq(practicalProgress.questionId, practicalQuestion.id),
    eq(practicalProgress.userId, userId),
  )).where(and(
    inArray(practicalQuestion.trackId, ids),
    eq(practicalQuestion.status, "APPROVED"),
    eq(practicalQuestion.isFixture, false),
  ));
  const stationRows = await db.select({
    trackId: practicalTrackOspeStation.trackId,
    stations: count(),
  }).from(practicalTrackOspeStation).where(inArray(practicalTrackOspeStation.trackId, ids)).groupBy(practicalTrackOspeStation.trackId);
  const stationsByTrack = new Map(stationRows.map((row) => [row.trackId, Number(row.stations)]));
  return tracks.map((track) => {
    const rows = progressRows.filter((row) => row.trackId === track.id);
    const attempted = rows.reduce((sum, row) => sum + (row.attempts ?? 0), 0);
    const correct = rows.reduce((sum, row) => sum + (row.correct ?? 0), 0);
    const wrong = rows.reduce((sum, row) => sum + (row.wrong ?? 0), 0);
    return {
      ...track,
      summary: {
        attempted,
        correct,
        wrong,
        accuracy: attempted ? Math.round(correct / attempted * 100) : null,
        wrongRemaining: rows.filter((row) => row.wrongRemaining).length,
      },
      ospeStationCount: stationsByTrack.get(track.id) ?? 0,
    };
  });
}
