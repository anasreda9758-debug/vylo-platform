CREATE TABLE "password_reset_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"request_key_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"reset_token_hash" text,
	"invalidated_at" timestamp,
	"consumed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "password_reset_challenge" ADD CONSTRAINT "password_reset_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "password_reset_challenge_request_key_idx" ON "password_reset_challenge" USING btree ("request_key_hash","created_at");
--> statement-breakpoint
CREATE INDEX "password_reset_challenge_reset_token_idx" ON "password_reset_challenge" USING btree ("reset_token_hash");
