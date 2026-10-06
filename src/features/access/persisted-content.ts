import { getAccessibleLecture, type LearningActor } from "./learning-access";

/** The caller's owner argument is never a substitute for the real session. */
export async function getPersistedContentActor(ownerId: string): Promise<LearningActor | null> {
  // Lazy import keeps offline administrative query modules independent of an
  // HTTP request. Student collection access itself always requires a session.
  const { getSession } = await import("@/shared/session");
  const session = await getSession();
  return session?.user.id === ownerId ? session.user : null;
}

/** Stored derivatives never acquire a new first-lecture preview entitlement. */
export async function getAccessibleSavedLectureIds(actor: LearningActor, lectureIds: string[]) {
  const allowed: string[] = [];
  for (const lectureId of new Set(lectureIds)) {
    const access = await getAccessibleLecture(actor, lectureId, { allowPreview: false });
    if (access.ok) allowed.push(lectureId);
  }
  return allowed;
}
