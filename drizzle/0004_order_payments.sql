ALTER TABLE "orders" ADD COLUMN "payers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "extra_payments" jsonb DEFAULT '[]'::jsonb NOT NULL;