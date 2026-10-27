CREATE TABLE "scan_cursors" (
	"account" text PRIMARY KEY NOT NULL,
	"until" text,
	"marks" text[] DEFAULT '{}'::text[] NOT NULL,
	"stuck" text,
	"stuck_runs" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
