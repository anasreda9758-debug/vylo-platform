CREATE TABLE "academic_period" (
	"id" text PRIMARY KEY NOT NULL,
	"academic_year" text NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module" ADD COLUMN "academic_period_id" text;
--> statement-breakpoint
ALTER TABLE "promo_code" ADD COLUMN "academic_period_id" text;
--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_academic_period_id_academic_period_id_fk" FOREIGN KEY ("academic_period_id") REFERENCES "public"."academic_period"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_academic_period_id_academic_period_id_fk" FOREIGN KEY ("academic_period_id") REFERENCES "public"."academic_period"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "academic_period_year_type_idx" ON "academic_period" USING btree ("academic_year","type");
--> statement-breakpoint
CREATE INDEX "academic_period_active_idx" ON "academic_period" USING btree ("active","starts_at","ends_at");
