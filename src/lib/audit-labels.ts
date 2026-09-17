/**
 * Split out from `src/lib/services/audit-log.ts` deliberately: that file also
 * imports `db` (the Postgres driver), so a client component importing anything
 * from it - even a pure label map - pulls the whole driver into the browser
 * bundle, which fails to resolve Node built-ins like `net`. These are plain
 * data with no server dependency, safe for `audit-filters.tsx`/`audit-rows.tsx`
 * to import directly.
 */

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  activity: 'Activity',
  attachment: 'Attachment',
  contact: 'Contact',
  custom_field: 'Custom field',
  discovery_result: 'Discovery result',
  import_batch: 'Import batch',
  mall_anchor: 'Mall anchor',
  market: 'Market',
  opportunity: 'Opportunity',
  outreach_status: 'Outreach status',
  parcel: 'Parcel',
  property: 'Property',
  scan: 'Scan',
  setting: 'Setting',
  transaction_stage: 'Transaction stage',
  user: 'User',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  approve: 'Approved',
  archive: 'Archived',
  bulk_add_tags: 'Bulk tagged',
  bulk_follow_up: 'Bulk follow-up',
  bulk_status_change: 'Bulk status change',
  commit: 'Committed',
  create: 'Created',
  delete: 'Deleted',
  discovery_link: 'Linked from discovery',
  follow_up: 'Follow-up set',
  link_contact: 'Contact linked',
  link_property: 'Property linked',
  promote: 'Promoted',
  queue: 'Queued',
  remove_from_pipeline: 'Removed from pipeline',
  reopen: 'Reopened',
  restore: 'Restored',
  stage_change: 'Stage changed',
  status_change: 'Status changed',
  unlink_contact: 'Contact unlinked',
  unlink_property: 'Property unlinked',
  update: 'Updated',
  update_contact_link: 'Contact link updated',
};

export const humanizeAuditTerm = (value: string, map: Record<string, string>): string =>
  map[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Only entity types with a real detail page get a link. */
export function auditEntityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'property': return `/properties/${entityId}`;
    case 'contact': return `/contacts/${entityId}`;
    case 'opportunity': return `/pipeline/${entityId}`;
    default: return null;
  }
}
