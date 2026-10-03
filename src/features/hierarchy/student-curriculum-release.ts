/** Product release is independent of academic-period dates and entitlements. */
export const STUDENT_RELEASED_ACADEMIC_YEARS: readonly number[] = [1, 2];

/** Unknown years fail closed; never infer a study year from a slug or term. */
export function isStudentAcademicYearReleased(studyYear: number | null | undefined) {
  return typeof studyYear === "number" && Number.isInteger(studyYear)
    && STUDENT_RELEASED_ACADEMIC_YEARS.includes(studyYear);
}
