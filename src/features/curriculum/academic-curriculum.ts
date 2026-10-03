import { db } from "@/shared/db";
import { getCurriculum } from "./queries";
import { getAcademicVisibility } from "@/features/hierarchy/academic-visibility-server";
import { filterAcademicModules } from "@/features/hierarchy/academic-visibility";
import type { LearningActor } from "@/features/access/learning-access";

export async function getAcademicStudyYears(actor: LearningActor, currentOnly = false) {
  const modules = await db.query.curriculumModule.findMany({ columns: { studyYear: true, academicPeriodId: true } });
  const visible = filterAcademicModules(modules, await getAcademicVisibility(), actor.role, currentOnly);
  return [...new Set(visible.map((m) => m.studyYear))].sort((a, b) => a - b);
}

export async function getAcademicCurriculum(actor: LearningActor, studyYear?: number, currentOnly = false) {
  const loaded = await getCurriculum(actor.id, studyYear);
  return filterAcademicModules(loaded, await getAcademicVisibility(), actor.role, currentOnly);
}

export async function getAcademicModuleBySlug(actor: LearningActor, slug: string) {
  return (await getAcademicCurriculum(actor)).find((m) => m.slug === slug) ?? null;
}
