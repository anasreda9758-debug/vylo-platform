CREATE TABLE "summer_access" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"module_id" text NOT NULL,
	"summer_session_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "summer_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "summer_access_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "summer_access_summer_session_id_academic_period_id_fk" FOREIGN KEY ("summer_session_id") REFERENCES "public"."academic_period"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "summer_access_user_module_session_idx" ON "summer_access" USING btree ("user_id","module_id","summer_session_id");
--> statement-breakpoint
CREATE INDEX "summer_access_user_expiry_idx" ON "summer_access" USING btree ("user_id","expires_at");
