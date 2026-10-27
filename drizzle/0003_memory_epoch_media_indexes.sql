ALTER TABLE "threads" ADD COLUMN "memory_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_ledger_charge_idx" ON "credit_ledger" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "media_source_idx" ON "media" USING btree ("source_media_id");--> statement-breakpoint
CREATE INDEX "media_character_idx" ON "media" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "media_pending_idx" ON "media" USING btree ("created_at") WHERE "media"."status" = 'pending';