import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/shared/db";
import { plan } from "../src/features/billing/schema";

// Full pricing matrix (user-confirmed):
//   Modules .............. 149 EGP each, duration per module
//   Non-core subjects ....  50 EGP each, valid for the whole term
//   Semester ............. 449 EGP, valid for the whole semester
//   Term 2 ............... 449 EGP, valid for the whole term
//
// Durations (months): AEH-101 4, PPG-102 3, PMB-103 2, RS-201 4, CVS-202 3,
// RAU-203 2.5, IBL-204 1.5. Non-core subjects last the whole term (120d).
// Term 1: end of Sep -> start of Feb (~4 months). Term 2: end of Feb -> end of Jun (~4 months).

type PlanSeed = {
  id: string;
  name: string;
  description: string;
  priceEg: number;
  durationDays: number;
  scope: "module" | "term" | "year";
  scopeRef: string | null;
};

const PLANS: PlanSeed[] = [
  // ---- Core modules (119 EGP) ----------------------------------------------------
  { id: "module-ahe-101", name: "AEH-101", description: "التشريح والأجنة والأنسجة — موديول واحد.", priceEg: 149, durationDays: 120, scope: "module", scopeRef: "ahe-101" },
  { id: "module-ppg-102", name: "PPG-102", description: "الفارماكولوجيا والبيولوجيا الجزيئية والفيزيولوجيا — موديول واحد.", priceEg: 149, durationDays: 90, scope: "module", scopeRef: "ppg-102" },
  { id: "module-pmb-103", name: "PMB-103", description: "الباثولوجيا والميكروبيولوجيا والكيمياء الحيوية — موديول واحد.", priceEg: 149, durationDays: 60, scope: "module", scopeRef: "pmb-103" },
  { id: "module-rs-201", name: "RS-201", description: "الجهاز التنفسي — موديول واحد.", priceEg: 149, durationDays: 120, scope: "module", scopeRef: "rs-201" },
  { id: "module-cvs-202", name: "CVS-202", description: "الجهاز القلبي الوعائي — موديول واحد.", priceEg: 149, durationDays: 90, scope: "module", scopeRef: "cvs-202" },
  { id: "module-rau-203", name: "RAU-203", description: "الجهاز البولي — موديول واحد.", priceEg: 149, durationDays: 75, scope: "module", scopeRef: "rau-203" },
  { id: "module-ibl-204", name: "IBL-204", description: "المناعة والدم والجهاز اللمفاوي — موديول واحد.", priceEg: 149, durationDays: 45, scope: "module", scopeRef: "ibl-204" },
  // ---- Non-core subjects (50 EGP, whole term) -------------------------------------
  { id: "module-mt-104", name: "MT-104", description: "المصطلحات الطبية — صالحة طوال الترم الأول.", priceEg: 50, durationDays: 120, scope: "module", scopeRef: "mt-104" },
  { id: "module-en-105", name: "EN-105", description: "اللغة الإنجليزية — صالحة طوال الترم الأول.", priceEg: 50, durationDays: 120, scope: "module", scopeRef: "en-105" },
  { id: "module-uni-205", name: "UNI-205", description: "القضايا المجتمعية — صالحة طوال الترم الثاني.", priceEg: 50, durationDays: 120, scope: "module", scopeRef: "uni-205" },
  // ---- Term plans (399 / 449 EGP) --------------------------------------------------
  { id: "term-1", name: "الترم الأول", description: "كل موديولات الترم الأول (AEH-101، PPG-102، PMB-103، MT-104، EN-105).", priceEg: 449, durationDays: 120, scope: "term", scopeRef: "1" },
  { id: "term-2", name: "الترم الثاني", description: "كل موديولات الترم الثاني (RS-201، CVS-202، RAU-203، IBL-204، UNI-205).", priceEg: 449, durationDays: 120, scope: "term", scopeRef: "2" },
  // ---- Year plan (749 EGP) --------------------------------------------------------
  { id: "year", name: "السنة كاملة", description: "كل موديولات الترمين الأول والثاني لمدة عام كامل.", priceEg: 749, durationDays: 365, scope: "year", scopeRef: null },
];

async function main() {
  // Deactivate plans no longer part of the matrix (legacy monthly/quarterly/annual)
  // instead of deleting — old subscriptions reference them via FK restrict.
  const ids = new Set(PLANS.map((p) => p.id));
  const existing = await db.query.plan.findMany();
  for (const e of existing) {
    if (!ids.has(e.id)) {
      await db.update(plan).set({ active: false }).where(eq(plan.id, e.id));
      console.log(`[seed-plans] deactivated legacy: ${e.id} (${e.name})`);
    }
  }

  for (const p of PLANS) {
    const current = await db.query.plan.findFirst({ where: eq(plan.id, p.id) });
    const values = { ...p, active: true };
    if (current) {
      await db.update(plan).set(values).where(eq(plan.id, p.id));
      console.log(`[seed-plans] updated: ${p.id} (${p.name})`);
    } else {
      await db.insert(plan).values(values);
      console.log(`[seed-plans] created: ${p.id} (${p.name})`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-plans] error:", err);
  process.exit(1);
});
