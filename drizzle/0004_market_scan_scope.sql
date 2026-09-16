ALTER TABLE "saved_views" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_targets" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_targets" ADD COLUMN "market_label" text;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "market_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ALTER COLUMN "market_ids" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scan_targets" ADD CONSTRAINT "scan_targets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;