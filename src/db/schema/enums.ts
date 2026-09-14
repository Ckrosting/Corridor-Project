import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Only genuinely fixed vocabularies live in Postgres enums. Anything the product
 * requires to be user-configurable (outreach statuses, transaction stages, tags,
 * custom fields) is a regular table with FKs so it can be renamed, recoloured,
 * reordered, archived and reassigned without a migration.
 */

export const userRoleEnum = pgEnum('user_role', ['admin', 'member']);

/** Geometry provenance. Manually drawn outlines are explicitly approximate. */
export const geometrySourceEnum = pgEnum('geometry_source', [
  'manual_draw', // drawn by a user on the map - approximate research outline
  'radius',      // generated from a mall anchor + radius
  'imported',    // came from an import file
]);

export const corridorBoundaryKindEnum = pgEnum('corridor_boundary_kind', ['radius', 'custom']);

/** Whether a property is for sale. Deliberately separate from outreach + transaction. */
export const listingStatusEnum = pgEnum('listing_status', [
  'off_market',
  'for_sale',
  'under_contract',
  'sold',
  'withdrawn',
  'unknown',
]);

export const activityTypeEnum = pgEnum('activity_type', [
  'call',
  'note',
  'email',
  'meeting',
  'status_change',
  'system',
]);

/** Suggested call outcomes. Only meaningful when activity_type = 'call'. */
export const callOutcomeEnum = pgEnum('call_outcome', [
  'no_answer',
  'voicemail_left',
  'wrong_number',
  'spoke_with_broker',
  'spoke_with_owner',
  'not_interested',
  'may_sell_later',
  'interested_in_selling',
  'requested_information',
]);

export const contactRoleEnum = pgEnum('contact_role', [
  'owner',
  'broker',
  'representative',
  'property_manager',
  'tenant',
  'attorney',
  'other',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'completed',
  'partial',
  'cancelled',
  'failed',
]);

export const scanScopeEnum = pgEnum('scan_scope', ['corridor', 'market', 'markets', 'all']);

/** Where a discovery candidate sits in the human review workflow. */
export const discoveryStatusEnum = pgEnum('discovery_status', [
  'new',
  'needs_research',
  'approved',       // became a property
  'linked',         // attached to an existing property
  'rejected',
  'archived',
  'duplicate',
]);

/** Result of checking a candidate's location against the saved corridor boundary. */
export const geoRelevanceEnum = pgEnum('geo_relevance', [
  'inside',
  'edge',       // within the review buffer outside the boundary
  'outside',
  'unknown',    // no usable coordinates - needs human review, never silently dropped
]);

export const customFieldTypeEnum = pgEnum('custom_field_type', [
  'text',
  'number',
  'date',
  'checkbox',
  'select',
]);

export const attachmentKindEnum = pgEnum('attachment_kind', [
  'flyer',
  'offering_memorandum',
  'photo',
  'document',
  'other',
]);

export const importKindEnum = pgEnum('import_kind', ['malls', 'properties', 'contacts']);

export const importStatusEnum = pgEnum('import_status', [
  'draft',      // uploaded + mapped, not yet committed
  'committed',
  'cancelled',
]);

export const opportunityStateEnum = pgEnum('opportunity_state', [
  'active',    // in the pipeline
  'removed',   // pulled from the active pipeline, history retained
]);
