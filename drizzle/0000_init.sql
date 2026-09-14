CREATE TYPE "public"."activity_type" AS ENUM('call', 'note', 'email', 'meeting', 'status_change', 'system');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('flyer', 'offering_memorandum', 'photo', 'document', 'other');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('no_answer', 'voicemail_left', 'wrong_number', 'spoke_with_broker', 'spoke_with_owner', 'not_interested', 'may_sell_later', 'interested_in_selling', 'requested_information');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('owner', 'broker', 'representative', 'property_manager', 'tenant', 'attorney', 'other');--> statement-breakpoint
CREATE TYPE "public"."corridor_boundary_kind" AS ENUM('radius', 'custom');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'date', 'checkbox', 'select');--> statement-breakpoint
CREATE TYPE "public"."discovery_status" AS ENUM('new', 'needs_research', 'approved', 'linked', 'rejected', 'archived', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."geo_relevance" AS ENUM('inside', 'edge', 'outside', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."geometry_source" AS ENUM('manual_draw', 'radius', 'imported');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('malls', 'properties', 'contacts');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('draft', 'committed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'partial', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('off_market', 'for_sale', 'under_contract', 'sold', 'withdrawn', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."opportunity_state" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."scan_scope" AS ENUM('corridor', 'market', 'markets', 'all');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"summary" text,
	"changes" jsonb,
	"actor_user_id" uuid,
	"actor_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corridors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"boundary_kind" "corridor_boundary_kind" DEFAULT 'radius' NOT NULL,
	"anchor_id" uuid,
	"center_latitude" double precision,
	"center_longitude" double precision,
	"radius_meters" double precision,
	"boundary" jsonb,
	"boundary_source" geometry_source DEFAULT 'radius' NOT NULL,
	"min_latitude" double precision,
	"max_latitude" double precision,
	"min_longitude" double precision,
	"max_longitude" double precision,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mall_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"county" text,
	"latitude" double precision,
	"longitude" double precision,
	"needs_map_placement" boolean DEFAULT true NOT NULL,
	"location_source" text,
	"location_set_at" timestamp with time zone,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"state" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"role" "contact_role" DEFAULT 'other' NOT NULL,
	"title" text,
	"phone" text,
	"phone_alt" text,
	"email" text,
	"notes" text,
	"source" text,
	"verified_at" timestamp with time zone,
	"owner_entity_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text DEFAULT 'property' NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"help_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"def_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "outreach_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"counts_as_active_pursuit" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"entity_type" text,
	"mailing_address" text,
	"notes" text,
	"source" text,
	"verified_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"name" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"county" text,
	"latitude" double precision,
	"longitude" double precision,
	"location_source" text,
	"location_confidence" text,
	"needs_map_placement" boolean DEFAULT false NOT NULL,
	"needs_parcel_outline" boolean DEFAULT true NOT NULL,
	"property_type" text,
	"land_acreage" numeric(12, 4),
	"building_sqft" integer,
	"occupancy_percent" numeric(5, 2),
	"tenant_info" text,
	"year_built" integer,
	"asking_price" numeric(14, 2),
	"target_purchase_price" numeric(14, 2),
	"seller_indicated_price" numeric(14, 2),
	"noi" numeric(14, 2),
	"cap_rate_reported" numeric(6, 3),
	"cap_rate_reported_source" text,
	"owner_entity_id" uuid,
	"listing_status" "listing_status" DEFAULT 'unknown' NOT NULL,
	"listing_date" date,
	"first_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"outreach_status_id" uuid,
	"next_follow_up_date" date,
	"research_notes" text,
	"human_verified" boolean DEFAULT false NOT NULL,
	"human_verified_at" timestamp with time zone,
	"human_verified_by" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_contacts" (
	"property_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"relationship" "contact_role" DEFAULT 'other' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_contacts_property_id_contact_id_relationship_pk" PRIMARY KEY("property_id","contact_id","relationship")
);
--> statement-breakpoint
CREATE TABLE "property_corridors" (
	"property_id" uuid NOT NULL,
	"corridor_id" uuid NOT NULL,
	"assigned_via" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_corridors_property_id_corridor_id_pk" PRIMARY KEY("property_id","corridor_id")
);
--> statement-breakpoint
CREATE TABLE "property_listing_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"source_name" text,
	"listed_price" numeric(14, 2),
	"listing_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"parcel_id_text" text,
	"label" text,
	"geometry" jsonb,
	"geometry_source" geometry_source DEFAULT 'manual_draw' NOT NULL,
	"acreage" numeric(12, 4),
	"notes" text,
	"min_latitude" double precision,
	"max_latitude" double precision,
	"min_longitude" double precision,
	"max_longitude" double precision,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" numeric(14, 2),
	"new_value" numeric(14, 2),
	"evidence_url" text,
	"evidence_note" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "property_tags" (
	"property_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_tags_property_id_tag_id_pk" PRIMARY KEY("property_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"type" "activity_type" DEFAULT 'note' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid,
	"contact_name_free_text" text,
	"outcome" "call_outcome",
	"subject" text,
	"notes" text,
	"seller_motivation" text,
	"pricing_expectation" text,
	"timing_notes" text,
	"price_mentioned" numeric(14, 2),
	"follow_up_date" date,
	"metadata" jsonb,
	"author_user_id" uuid,
	"author_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"opportunity_id" uuid,
	"discovery_result_id" uuid,
	"kind" "attachment_kind" DEFAULT 'document' NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text,
	"description" text,
	"uploaded_by" uuid,
	"uploaded_by_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"filters" jsonb NOT NULL,
	"corridor_id" uuid,
	"owner_user_id" uuid,
	"is_shared" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"market_id" uuid,
	"stage_id" uuid NOT NULL,
	"state" "opportunity_state" DEFAULT 'active' NOT NULL,
	"promotion_reason" text NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_by" uuid,
	"promoted_by_label" text,
	"target_price" numeric(14, 2),
	"offer_price" numeric(14, 2),
	"contract_price" numeric(14, 2),
	"expected_close_date" date,
	"next_step_date" date,
	"next_step" text,
	"notes" text,
	"closed_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_properties" (
	"opportunity_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_properties_opportunity_id_property_id_pk" PRIMARY KEY("opportunity_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"from_stage_label" text,
	"to_stage_label" text,
	"note" text,
	"changed_by" uuid,
	"changed_by_label" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'open' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested" timestamp with time zone,
	"cancel_requested_by" uuid,
	"last_error" text,
	"result" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid,
	"model" text NOT NULL,
	"operation" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid,
	"corridor_id" uuid,
	"market_id" uuid,
	"status" "discovery_status" DEFAULT 'new' NOT NULL,
	"origin" text DEFAULT 'scan' NOT NULL,
	"name" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"county" text,
	"latitude" double precision,
	"longitude" double precision,
	"property_type" text,
	"asking_price" numeric(14, 2),
	"building_sqft" integer,
	"land_acreage" numeric(12, 4),
	"listing_date" date,
	"owner_name" text,
	"broker_name" text,
	"broker_company" text,
	"broker_phone" text,
	"broker_email" text,
	"field_sources" jsonb,
	"needs_verification" jsonb,
	"sources" jsonb,
	"evidence_excerpt" text,
	"geo_relevance" "geo_relevance" DEFAULT 'unknown' NOT NULL,
	"geo_note" text,
	"normalized_url" text,
	"dedupe_hash" text,
	"suggested_property_id" uuid,
	"suggested_match_score" numeric(5, 4),
	"suggested_match_reason" text,
	"proposed_changes" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"linked_property_id" uuid,
	"reviewed_by" uuid,
	"reviewed_by_label" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_type" text NOT NULL,
	"key_value" text NOT NULL,
	"reason" text NOT NULL,
	"property_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "import_kind" NOT NULL,
	"status" "import_status" DEFAULT 'draft' NOT NULL,
	"filename" text NOT NULL,
	"column_mapping" jsonb,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"mapped" jsonb,
	"errors" jsonb,
	"warnings" jsonb,
	"verdict" text DEFAULT 'new' NOT NULL,
	"duplicate_of_id" uuid,
	"action" text DEFAULT 'create' NOT NULL,
	"committed_entity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "scan_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"corridor_id" uuid,
	"corridor_label" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"results_found" integer DEFAULT 0 NOT NULL,
	"sources_searched" jsonb,
	"coverage_notes" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"scope" "scan_scope" NOT NULL,
	"corridor_ids" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"model" text NOT NULL,
	"targets_total" integer DEFAULT 0 NOT NULL,
	"targets_completed" integer DEFAULT 0 NOT NULL,
	"results_found" integer DEFAULT 0 NOT NULL,
	"results_new" integer DEFAULT 0 NOT NULL,
	"results_duplicate" integer DEFAULT 0 NOT NULL,
	"coverage_notes" jsonb,
	"error" text,
	"requested_by" uuid,
	"requested_by_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corridors" ADD CONSTRAINT "corridors_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corridors" ADD CONSTRAINT "corridors_anchor_id_mall_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."mall_anchors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corridors" ADD CONSTRAINT "corridors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mall_anchors" ADD CONSTRAINT "mall_anchors_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mall_anchors" ADD CONSTRAINT "mall_anchors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_entity_id_owner_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."owner_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_def_id_custom_field_defs_id_fk" FOREIGN KEY ("def_id") REFERENCES "public"."custom_field_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_entities" ADD CONSTRAINT "owner_entities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_entity_id_owner_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."owner_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_outreach_status_id_outreach_statuses_id_fk" FOREIGN KEY ("outreach_status_id") REFERENCES "public"."outreach_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_human_verified_by_users_id_fk" FOREIGN KEY ("human_verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_corridors" ADD CONSTRAINT "property_corridors_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_corridors" ADD CONSTRAINT "property_corridors_corridor_id_corridors_id_fk" FOREIGN KEY ("corridor_id") REFERENCES "public"."corridors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_listing_sources" ADD CONSTRAINT "property_listing_sources_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_parcels" ADD CONSTRAINT "property_parcels_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_parcels" ADD CONSTRAINT "property_parcels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_price_history" ADD CONSTRAINT "property_price_history_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_price_history" ADD CONSTRAINT "property_price_history_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tags" ADD CONSTRAINT "property_tags_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tags" ADD CONSTRAINT "property_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_transaction_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."transaction_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_promoted_by_users_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_properties" ADD CONSTRAINT "opportunity_properties_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_properties" ADD CONSTRAINT "opportunity_properties_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_from_stage_id_transaction_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."transaction_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_to_stage_id_transaction_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."transaction_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_cancel_requested_by_users_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_corridor_id_corridors_id_fk" FOREIGN KEY ("corridor_id") REFERENCES "public"."corridors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_suggested_property_id_properties_id_fk" FOREIGN KEY ("suggested_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_linked_property_id_properties_id_fk" FOREIGN KEY ("linked_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_suppressions" ADD CONSTRAINT "discovery_suppressions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_suppressions" ADD CONSTRAINT "discovery_suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_targets" ADD CONSTRAINT "scan_targets_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_targets" ADD CONSTRAINT "scan_targets_corridor_id_corridors_id_fk" FOREIGN KEY ("corridor_id") REFERENCES "public"."corridors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "corridors_market_idx" ON "corridors" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "corridors_bbox_idx" ON "corridors" USING btree ("min_latitude","max_latitude","min_longitude","max_longitude");--> statement-breakpoint
CREATE INDEX "mall_anchors_market_idx" ON "mall_anchors" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "mall_anchors_placement_idx" ON "mall_anchors" USING btree ("needs_map_placement");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_slug_unq" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "contacts" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree (lower("company"));--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_defs_entity_key_unq" ON "custom_field_defs" USING btree ("entity","key");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_unq" ON "custom_field_values" USING btree ("def_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_statuses_key_unq" ON "outreach_statuses" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_statuses_one_default" ON "outreach_statuses" USING btree ("is_default") WHERE "outreach_statuses"."is_default" = true;--> statement-breakpoint
CREATE INDEX "owner_entities_name_idx" ON "owner_entities" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "properties_market_idx" ON "properties" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "properties_latlng_idx" ON "properties" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "properties_outreach_idx" ON "properties" USING btree ("outreach_status_id");--> statement-breakpoint
CREATE INDEX "properties_listing_idx" ON "properties" USING btree ("listing_status");--> statement-breakpoint
CREATE INDEX "properties_followup_idx" ON "properties" USING btree ("next_follow_up_date");--> statement-breakpoint
CREATE INDEX "properties_archived_idx" ON "properties" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "properties_sample_idx" ON "properties" USING btree ("is_sample");--> statement-breakpoint
CREATE INDEX "properties_address_idx" ON "properties" USING btree (lower("address_line1"));--> statement-breakpoint
CREATE INDEX "property_contacts_contact_idx" ON "property_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "property_corridors_corridor_idx" ON "property_corridors" USING btree ("corridor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_sources_prop_url_unq" ON "property_listing_sources" USING btree ("property_id","normalized_url");--> statement-breakpoint
CREATE INDEX "listing_sources_norm_url_idx" ON "property_listing_sources" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "parcels_property_idx" ON "property_parcels" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "parcels_bbox_idx" ON "property_parcels" USING btree ("min_latitude","max_latitude","min_longitude","max_longitude");--> statement-breakpoint
CREATE INDEX "parcels_parcel_id_idx" ON "property_parcels" USING btree (lower("parcel_id_text"));--> statement-breakpoint
CREATE INDEX "price_history_property_idx" ON "property_price_history" USING btree ("property_id","observed_at");--> statement-breakpoint
CREATE INDEX "property_tags_tag_idx" ON "property_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_unq" ON "tags" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "activities_property_idx" ON "activities" USING btree ("property_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_author_idx" ON "activities" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "activities_type_idx" ON "activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "activities_followup_idx" ON "activities" USING btree ("follow_up_date");--> statement-breakpoint
CREATE INDEX "attachments_property_idx" ON "attachments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "attachments_opportunity_idx" ON "attachments" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "attachments_discovery_idx" ON "attachments" USING btree ("discovery_result_id");--> statement-breakpoint
CREATE INDEX "attachments_checksum_idx" ON "attachments" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "saved_views_owner_idx" ON "saved_views" USING btree ("owner_user_id","scope");--> statement-breakpoint
CREATE INDEX "opportunities_stage_idx" ON "opportunities" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "opportunities_state_idx" ON "opportunities" USING btree ("state");--> statement-breakpoint
CREATE INDEX "opportunities_market_idx" ON "opportunities" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "opportunities_nextstep_idx" ON "opportunities" USING btree ("next_step_date");--> statement-breakpoint
CREATE INDEX "opportunity_properties_property_idx" ON "opportunity_properties" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "opportunity_stage_history_idx" ON "opportunity_stage_history" USING btree ("opportunity_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_stages_key_unq" ON "transaction_stages" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_stages_one_default" ON "transaction_stages" USING btree ("is_default") WHERE "transaction_stages"."is_default" = true;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_active_unq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "jobs_heartbeat_idx" ON "jobs" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "discovery_status_idx" ON "discovery_results" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "discovery_corridor_idx" ON "discovery_results" USING btree ("corridor_id");--> statement-breakpoint
CREATE INDEX "discovery_scan_idx" ON "discovery_results" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "discovery_norm_url_idx" ON "discovery_results" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "discovery_dedupe_idx" ON "discovery_results" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_suppression_unq" ON "discovery_suppressions" USING btree ("key_type","key_value");--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "scan_targets_scan_idx" ON "scan_targets" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "scans_created_idx" ON "scans" USING btree ("created_at");