CREATE TABLE "checked_signatures" (
	"signature" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extra_payments" (
	"signature" text PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"payer" text,
	"received" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extra_payments" ADD CONSTRAINT "extra_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_payments_order_idx" ON "extra_payments" USING btree ("order_id");--> statement-breakpoint
-- Carries over what the old column held, one row per signature. A signature kept against several orders, or that is some order's own payment, came from a transaction naming several references and is left out.
INSERT INTO "extra_payments" ("signature", "order_id", "reason", "payer", "received", "created_at")
SELECT e->>'signature', o."id", e->>'reason', e->>'payer', (e->>'received')::bigint, (e->>'at')::timestamptz
FROM "orders" o, jsonb_array_elements(o."extra_payments") e
WHERE NOT EXISTS (SELECT 1 FROM "orders" p WHERE p."signature" = e->>'signature')
  AND (SELECT count(*) FROM "orders" q, jsonb_array_elements(q."extra_payments") f WHERE f->>'signature' = e->>'signature') = 1;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "extra_payments";