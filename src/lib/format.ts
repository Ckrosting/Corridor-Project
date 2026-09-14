/**
 * Display formatting shared by server and client.
 *
 * The central rule: unknown is NOT zero. Every formatter here renders null and
 * undefined as an explicit em-dash placeholder, so a blank NOI never reads as
 * "$0" and an unrecorded acreage never reads as "0 ac".
 */

export const UNKNOWN = '—';

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Drizzle returns `numeric` columns as strings to preserve precision. */
export function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(v: string | number | null | undefined, opts: { cents?: boolean } = {}): string {
  const n = toNumber(v);
  if (n === null) return UNKNOWN;
  return opts.cents ? money2.format(n) : money0.format(n);
}

export function formatNumber(v: string | number | null | undefined, suffix = ''): string {
  const n = toNumber(v);
  if (n === null) return UNKNOWN;
  return `${int.format(n)}${suffix}`;
}

export function formatAcres(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return UNKNOWN;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ac`;
}

export function formatSqft(v: number | null | undefined): string {
  if (v === null || v === undefined) return UNKNOWN;
  return `${int.format(v)} sf`;
}

export function formatPercent(v: string | number | null | undefined, digits = 1): string {
  const n = toNumber(v);
  if (n === null) return UNKNOWN;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/* -------------------------------------------------------------------------- */
/* Cap rate                                                                   */
/* -------------------------------------------------------------------------- */

export interface CapRateView {
  reported: number | null;
  reportedSource: string | null;
  calculated: number | null;
  /** Which price the calculation used, so the number is never unexplained. */
  calculatedBasis: 'asking price' | 'seller indicated price' | 'target purchase price' | null;
  /** True when the two differ by more than a quarter point. */
  disagrees: boolean;
}

/**
 * Reported and calculated cap rates are kept strictly distinct. The reported
 * value is whatever a broker claimed; the calculated value is NOI divided by a
 * price we can name. They are never merged, and a missing price yields null
 * rather than a misleading zero.
 */
export function capRateView(p: {
  capRateReported?: string | number | null;
  capRateReportedSource?: string | null;
  noi?: string | number | null;
  askingPrice?: string | number | null;
  sellerIndicatedPrice?: string | number | null;
  targetPurchasePrice?: string | number | null;
}): CapRateView {
  const reported = toNumber(p.capRateReported);
  const noi = toNumber(p.noi);

  const basisOrder: Array<[number | null, CapRateView['calculatedBasis']]> = [
    [toNumber(p.askingPrice), 'asking price'],
    [toNumber(p.sellerIndicatedPrice), 'seller indicated price'],
    [toNumber(p.targetPurchasePrice), 'target purchase price'],
  ];
  const basis = basisOrder.find(([price]) => price !== null && price > 0);

  let calculated: number | null = null;
  let calculatedBasis: CapRateView['calculatedBasis'] = null;
  if (noi !== null && basis) {
    calculated = (noi / basis[0]!) * 100;
    calculatedBasis = basis[1];
  }

  return {
    reported,
    reportedSource: p.capRateReportedSource ?? null,
    calculated,
    calculatedBasis,
    disagrees: reported !== null && calculated !== null && Math.abs(reported - calculated) > 0.25,
  };
}

export const formatCapRate = (v: number | null): string =>
  v === null ? UNKNOWN : `${v.toFixed(2)}%`;

/* -------------------------------------------------------------------------- */
/* Addresses and dates                                                        */
/* -------------------------------------------------------------------------- */

export function formatAddress(p: {
  addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null;
}): string {
  const street = p.addressLine1?.trim();
  const locality = [p.city?.trim(), p.state?.trim()].filter(Boolean).join(', ');
  const tail = [locality, p.postalCode?.trim()].filter(Boolean).join(' ');
  return [street, tail].filter(Boolean).join(', ') || UNKNOWN;
}

/** Title for a property that may have no name: falls back to its address. */
export function propertyTitle(p: { name?: string | null; addressLine1?: string | null; city?: string | null }): string {
  const name = p.name?.trim();
  if (name) return name;
  const addr = p.addressLine1?.trim();
  if (addr) return addr;
  const city = p.city?.trim();
  return city ? `Untitled property in ${city}` : 'Untitled property';
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return UNKNOWN;
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T12:00:00Z` : v) : v;
  if (Number.isNaN(d.getTime())) return UNKNOWN;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return UNKNOWN;
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return UNKNOWN;
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "3 days ago" / "in 5 days" / "today" for follow-up urgency. */
export function relativeDays(dateStr: string | null | undefined): { days: number; label: string } | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 864e5);
  if (days === 0) return { days, label: 'today' };
  if (days === 1) return { days, label: 'tomorrow' };
  if (days === -1) return { days, label: 'yesterday' };
  return { days, label: days < 0 ? `${Math.abs(days)} days overdue` : `in ${days} days` };
}

/** ISO date (YYYY-MM-DD) in local time, for date inputs. */
export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const LISTING_STATUS_LABELS: Record<string, string> = {
  off_market: 'Off market',
  for_sale: 'For sale',
  under_contract: 'Under contract',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
  unknown: 'Unknown',
};

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  no_answer: 'No answer',
  voicemail_left: 'Voicemail left',
  wrong_number: 'Wrong number',
  spoke_with_broker: 'Spoke with broker',
  spoke_with_owner: 'Spoke with owner',
  not_interested: 'Not interested',
  may_sell_later: 'May sell later',
  interested_in_selling: 'Interested in selling',
  requested_information: 'Requested information',
};

export const CONTACT_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  broker: 'Broker',
  representative: 'Representative',
  property_manager: 'Property manager',
  tenant: 'Tenant',
  attorney: 'Attorney',
  other: 'Other',
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  call: 'Call',
  note: 'Note',
  email: 'Email',
  meeting: 'Meeting',
  status_change: 'Status change',
  system: 'System',
};
