ALTER TABLE "characters" ADD COLUMN "explicit_image_url" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "explicit_image_media_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age_attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "explicit_hold_at" timestamp with time zone;