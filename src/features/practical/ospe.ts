import type { LearningActor } from "@/features/access/learning-access";
import type { PracticalTrackResolution } from "./model";

/** Subject scope is explicit: filenames and folders never infer a practical track. */
export function ospeAnswerKeysBelongToTrack(answerKeyIds: (string | null)[], associatedAnswerKeyIds: string[]) {
  if (answerKeyIds.length === 0 || answerKeyIds.some((id) => !id)) return false;
  const allowed = new Set(associatedAnswerKeyIds);
  return answerKeyIds.every((id) => id !== null && allowed.has(id));
}

export function isPracticalOspeAvailable(ospeEnabled: boolean, associatedStationCount: number) {
  return ospeEnabled && associatedStationCount > 0;
}

type ResolveTrack = (
  actor: LearningActor | null | undefined,
  moduleSlug: string,
  subjectSlug: string,
) => Promise<PracticalTrackResolution>;
type CountStations = (trackId: string) => Promise<number>;

export function createPracticalOspeScopeResolver(resolveTrack: ResolveTrack, countStations: CountStations) {
  return async (actor: LearningActor | null | undefined, moduleSlug: string, subjectSlug: string): Promise<PracticalTrackResolution> => {
    const resolution = await resolveTrack(actor, moduleSlug, subjectSlug);
    if (!resolution.ok) return resolution;
    const stationCount = await countStations(resolution.value.id);
    if (!isPracticalOspeAvailable(resolution.value.ospeEnabled, stationCount)) return { ok: false, reason: "not_found" };
    return resolution;
  };
}
