import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/shared/db";
import { promoCode } from "../src/features/billing/schema";

const INITIAL_CODES = [
  {
    id: "promo-vylostart",
    code: "VYLOSTART",
    description: "VYLO launch discount",
    discountType: "PERCENTAGE",
    discountValue: 10,
    appliesTo: "ANY",
    maxUses: 100,
    maxUsesPerUser: 1,
  },
  {
    id: "promo-vylosem50",
    code: "VYLOSEM50",
    description: "Semester launch discount",
    discountType: "FIXED_EGP",
    discountValue: 50,
    appliesTo: "FULL_TERM",
    maxUses: null,
    maxUsesPerUser: 1,
  },
] as const;

async function main() {
  for (const code of INITIAL_CODES) {
    const existing = await db.query.promoCode.findFirst({ where: eq(promoCode.id, code.id) });
    if (existing) {
      await db.update(promoCode).set({ ...code, active: true, updatedAt: new Date() }).where(eq(promoCode.id, code.id));
    } else {
      await db.insert(promoCode).values({ ...code, active: true });
    }
  }
  console.log(`[seed-promos] ensured ${INITIAL_CODES.length} initial codes`);
}

main().catch((error) => {
  console.error("[seed-promos] error:", error);
  process.exitCode = 1;
});
