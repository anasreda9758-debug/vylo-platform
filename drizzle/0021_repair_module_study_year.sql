-- Repair migration for databases where 0013 was recorded without applying its module changes.
ALTER TABLE "module" ADD COLUMN IF NOT EXISTS "study_year" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_study_year_idx" ON "module" USING btree ("study_year");
