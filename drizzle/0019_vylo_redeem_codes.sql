ALTER TABLE "promo_code" ADD COLUMN "internal_label" text;
--> statement-breakpoint
ALTER TABLE "promo_code" ADD COLUMN "reward_type" text DEFAULT 'PERCENTAGE_DISCOUNT' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemption_code_user_unique" ON "promo_redemption" USING btree ("promo_code_id","user_id");
