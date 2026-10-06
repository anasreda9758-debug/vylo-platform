-- VYLO billing: canonical integer-piaster amounts.
--
-- ADDITIVE and idempotent. Legacy `price_eg` / `amount_eg` columns are kept and
-- remain the source of truth until the application is deployed reading the new
-- `*_cents` columns, so this migration is safe to apply ahead of the code and
-- safe to re-run (columns guarded, backfill only fills NULLs).
--
-- Historical rows (payments, existing subscriptions) are not modified apart
-- from the additive piaster backfill.

ALTER TABLE "plan" ADD COLUMN IF NOT EXISTS "price_cents" integer;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "amount_cents" integer;
--> statement-breakpoint

-- Backfill from the legacy whole-EGP columns (1 EGP = 100 piasters).
UPDATE "plan" SET "price_cents" = "price_eg" * 100 WHERE "price_cents" IS NULL;
--> statement-breakpoint
UPDATE "payment" SET "amount_cents" = "amount_eg" * 100 WHERE "amount_cents" IS NULL;
--> statement-breakpoint

-- Align billable medical module plans with the approved 149 EGP price. Legacy
-- rows had stale values (e.g. 119 EGP). Requirement/elective/placeholder plans
-- are intentionally left untouched (they are not purchasable).
UPDATE "plan" AS p
SET "price_cents" = 14900
WHERE p."scope" = 'module'
	AND p."scope_ref" IN (
		SELECT m."slug" FROM "module" AS m
		WHERE m."slug" NOT IN ('mt-104', 'en-105', 'uni-205', 'e-1', 'e-2', 'e-3', 'e-4')
	);
--> statement-breakpoint

-- Align configured term plans with the approved formula:
--   (eligible medical modules x 149 EGP) - 20% full-term discount.
-- Requirement courses (mt-104, en-105, uni-205) and elective placeholders
-- (e-1..e-4) never count. Only existing term plan rows are touched.
UPDATE "plan" AS p
SET "price_cents" = sub."cents"
FROM (
	SELECT
		m."term",
		round((count(*) * 14900) * (1 - 20.0 / 100))::int AS "cents"
	FROM "module" AS m
	WHERE m."slug" NOT IN ('mt-104', 'en-105', 'uni-205', 'e-1', 'e-2', 'e-3', 'e-4')
	GROUP BY m."term"
) AS sub
WHERE p."scope" = 'term'
	AND p."scope_ref" = sub."term"::text;
--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_price_cents_nonnegative') THEN
		ALTER TABLE "plan" ADD CONSTRAINT "plan_price_cents_nonnegative" CHECK ("price_cents" IS NULL OR "price_cents" >= 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_amount_cents_nonnegative') THEN
		ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_cents_nonnegative" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0);
	END IF;
END $$;
