CREATE TABLE "age_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"session_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "age_checks_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"age" integer NOT NULL,
	"gender" text NOT NULL,
	"ethnicity" text NOT NULL,
	"body" text NOT NULL,
	"role" text NOT NULL,
	"heat" text NOT NULL,
	"line" text NOT NULL,
	"color" text DEFAULT '#3a3348' NOT NULL,
	"lane" text NOT NULL,
	"style" text DEFAULT 'realistic' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_url" text,
	"image_media_id" uuid,
	"hair" text,
	"hair_style" text,
	"eye_color" text,
	"breast" text,
	"personality" text,
	"occupation" text,
	"kinks" text[] DEFAULT '{}'::text[] NOT NULL,
	"voice" text,
	"lora_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "characters_adult" CHECK ("characters"."age" >= 18)
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_non_negative" CHECK ("credit_balances"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"character_id" text,
	"thread_id" uuid,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"mime_type" text,
	"prompt" text,
	"source_media_id" uuid,
	"job_id" text,
	"moderation" jsonb,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"source_message_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"media_id" uuid,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"target_type" text NOT NULL,
	"target_id" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"usd_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"mint" text,
	"amount" bigint NOT NULL,
	"recipient" text NOT NULL,
	"reference" text NOT NULL,
	"quote" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature" text,
	"payer" text,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference"),
	CONSTRAINT "orders_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"photo_media_id" uuid,
	"gender" text DEFAULT 'Man' NOT NULL,
	"looking" text[] DEFAULT '{}'::text[] NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid,
	"reporter_email" text,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"last_preview" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"summarized_count" integer DEFAULT 0 NOT NULL,
	"disclosed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_id" text NOT NULL,
	"display_name" text DEFAULT 'You' NOT NULL,
	"wallet_address" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"age_status" text DEFAULT 'none' NOT NULL,
	"age_verified_at" timestamp with time zone,
	"member_until" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"banned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_id_unique" UNIQUE("privy_id")
);
--> statement-breakpoint
ALTER TABLE "age_checks" ADD CONSTRAINT "age_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_owner_idx" ON "characters" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_ref_idx" ON "credit_ledger" USING btree ("reason","ref_type","ref_id") WHERE "credit_ledger"."ref_id" is not null and "credit_ledger"."reason" in ('purchase', 'membership', 'refund');--> statement-breakpoint
CREATE INDEX "media_user_idx" ON "media" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_job_idx" ON "media" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "memories_owner_idx" ON "memories" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_events_open_idx" ON "moderation_events" USING btree ("action","reviewed_at");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_user_character_idx" ON "threads" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "threads_user_recent_idx" ON "threads" USING btree ("user_id","last_message_at");