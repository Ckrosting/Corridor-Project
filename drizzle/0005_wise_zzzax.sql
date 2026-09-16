ALTER TABLE "discovery_results" ADD COLUMN "noi" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "discovery_results" ADD COLUMN "cap_rate_reported" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "discovery_results" ADD COLUMN "year_built" integer;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD COLUMN "tenant_info" text;