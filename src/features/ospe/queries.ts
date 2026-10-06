import { inArray } from "drizzle-orm";
import { db } from "@/shared/db";
import { curriculumModule } from "@/features/curriculum/schema";
import { OSPE_FOLDER_TO_MODULE } from "./data";
import { canAccessModule, type LearningActor } from "@/features/access/learning-access";
import { isModuleAcademicallyVisible } from "@/features/hierarchy/academic-visibility-server";

export type OspeFolderAccess = {
  folder: string;
  moduleSlug: string;
  moduleName: string;
  isFree: boolean;
  term: number;
  locked: boolean;
};

export async function getOspeModuleAccess(user: LearningActor): Promise<OspeFolderAccess[]> {
  const slugs = [...new Set(Object.values(OSPE_FOLDER_TO_MODULE))];
  const modules = await db.query.curriculumModule.findMany({
    where: inArray(curriculumModule.slug, slugs),
  });
  const bySlug = new Map(modules.map((m) => [m.slug, m]));

  const out: OspeFolderAccess[] = [];
  for (const [folder, slug] of Object.entries(OSPE_FOLDER_TO_MODULE)) {
    const m = bySlug.get(slug);
    if (!m || !(await isModuleAcademicallyVisible(user, m))) continue;
    const isFree = m?.isFree ?? false;
    const accessible = m ? (await canAccessModule(user, m)).ok : false;
    out.push({
      folder,
      moduleSlug: slug,
      moduleName: m?.name ?? slug,
      isFree,
      term: m?.term ?? 1,
      locked: !accessible,
    });
  }
  return out;
}
