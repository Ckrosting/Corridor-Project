/**
 * Why a deal died. Fixed list so lost deals can be counted against each other;
 * the free-text note carries the specifics that never fit a taxonomy.
 */
export const LOST_REASONS = [
  { value: 'price', label: 'Price gap' },
  { value: 'timing', label: 'Timing' },
  { value: 'seller_changed_mind', label: 'Seller changed mind' },
  { value: 'another_buyer', label: 'Went with another buyer' },
  { value: 'withdrawn', label: 'Off-market / withdrawn' },
  { value: 'underwriting', label: 'Failed underwriting / diligence' },
  { value: 'other', label: 'Other' },
] as const;

export type LostReason = (typeof LOST_REASONS)[number]['value'];

export const LOST_REASON_VALUES = LOST_REASONS.map((r) => r.value) as [LostReason, ...LostReason[]];

export function lostReasonLabel(value: string | null | undefined): string | null {
  return LOST_REASONS.find((r) => r.value === value)?.label ?? null;
}
