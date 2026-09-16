ALTER TABLE "corridors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_corridors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "corridors" CASCADE;--> statement-breakpoint
DROP TABLE "property_corridors" CASCADE;--> statement-breakpoint
ALTER TABLE "scans" ALTER COLUMN "scope" SET DATA TYPE text;--> statement-breakpoint
UPDATE "scans" SET "scope" = 'market' WHERE "scope" = 'corridor';--> statement-breakpoint
DROP TYPE "public"."scan_scope";--> statement-breakpoint
CREATE TYPE "public"."scan_scope" AS ENUM('market', 'markets', 'all');--> statement-breakpoint
ALTER TABLE "scans" ALTER COLUMN "scope" SET DATA TYPE "public"."scan_scope" USING "scope"::"public"."scan_scope";--> statement-breakpoint
DROP INDEX "discovery_corridor_idx";--> statement-breakpoint
CREATE INDEX "discovery_market_idx" ON "discovery_results" USING btree ("market_id");--> statement-breakpoint
ALTER TABLE "saved_views" DROP COLUMN "corridor_id";--> statement-breakpoint
ALTER TABLE "discovery_results" DROP COLUMN "corridor_id";--> statement-breakpoint
ALTER TABLE "discovery_results" DROP COLUMN "geo_relevance";--> statement-breakpoint
ALTER TABLE "scan_targets" DROP COLUMN "corridor_id";--> statement-breakpoint
ALTER TABLE "scan_targets" DROP COLUMN "corridor_label";--> statement-breakpoint
ALTER TABLE "scans" DROP COLUMN "corridor_ids";--> statement-breakpoint
DROP TYPE "public"."corridor_boundary_kind";--> statement-breakpoint
DROP TYPE "public"."geo_relevance";