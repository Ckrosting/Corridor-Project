'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Camera, Check, Copy, ExternalLink, Mail, MapPin, Phone, Squircle, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  ACTIVITY_TYPE_LABELS, CALL_OUTCOME_LABELS, CONTACT_ROLE_LABELS, LISTING_STATUS_LABELS,
  capRateView, formatAcres, formatAddress, formatCapRate, formatDate, formatDateTime,
  formatMoney, formatPercent, formatSqft, propertyTitle, relativeDays, UNKNOWN,
} from '@/lib/format';
import {
  ApproximateBoundaryNote, EmptyState, Field, SampleBadge, SectionHeading,
  Spinner, StatusChip, Value,
} from '@/components/ui/primitives';
import { streetViewUrl } from '@/lib/geo/street-view';
import { CallLogger, type OutreachStatusOption } from './call-logger';
import { PromoteDialog } from './promote-dialog';

/** Shape returned by GET /api/properties/[id]. */
interface PropertyDetailData {
  id: string;
  name: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  landAcreage: string | null;
  buildingSqft: number | null;
  occupancyPercent: string | null;
  tenantInfo: string | null;
  askingPrice: string | null;
  targetPurchasePrice: string | null;
  sellerIndicatedPrice: string | null;
  noi: string | null;
  capRateReported: string | null;
  capRateReportedSource: string | null;
  listingStatus: string;
  listingDate: string | null;
  firstDiscoveredAt: string;
  lastVerifiedAt: string | null;
  nextFollowUpDate: string | null;
  researchNotes: string | null;
  needsParcelOutline: boolean;
  isSample: boolean;
  version: number;
  outreachStatus: { id: string; label: string; color: string } | null;
  ownerEntity: { id: string; name: string; entityType: string | null; mailingAddress: string | null } | null;
  parcels: Array<{ id: string; parcelIdText: string | null; label: string | null; acreage: string | null; geometry: unknown }>;
  contacts: Array<{
    contact: { id: string; name: string; company: string | null; phone: string | null; email: string | null; notes: string | null; verifiedAt: string | null; source: string | null };
    relationship: string;
    isPrimary: boolean;
  }>;
  tags: Array<{ id: string; name: string; color: string }>;
  timeline: Array<{
    id: string; type: string; outcome: string | null; subject: string | null; notes: string | null;
    occurredAt: string; authorLabel: string | null; contactName: string | null;
    sellerMotivation: string | null; pricingExpectation: string | null; timingNotes: string | null;
  }>;
  listingSources: Array<{ id: string; url: string; sourceName: string | null }>;
  opportunities: Array<{ id: string; name: string; state: string; stageLabel: string | null; stageColor: string | null; promotedAt: string; promotionReason: string }>;
}

type Tab = 'overview' | 'calls' | 'contacts' | 'financial' | 'parcels';

/**
 * The property side panel.
 *
 * Opening it never moves the map — the parent keeps its viewport — so the user
 * does not lose their place while working a market.
 */
export function PropertyPanel({
  propertyId, statuses, isAdmin, onClose, onChanged, onZoomToProperty,
}: {
  propertyId: string;
  statuses: OutreachStatusOption[];
  isAdmin: boolean;
  onClose(): void;
  onChanged(): void;
  onZoomToProperty(): void;
}) {
  const [data, setData] = useState<PropertyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [copied, setCopied] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      if (!res.ok) throw new Error('Could not load this property.');
      const body = (await res.json()) as { property: PropertyDetailData };
      setData(body.property);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this property.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  async function deleteProperty() {
    if (!data) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/properties/${data.id}?version=${data.version}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not delete this property.');
      onChanged();
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this property.');
      setDeleting(false);
    }
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  }

  if (loading && !data) {
    return (
      <PanelShell onClose={onClose} title="Loading…">
        <div className="flex items-center gap-2 p-4 text-sm text-ink-500"><Spinner /> Loading property…</div>
      </PanelShell>
    );
  }

  if (error && !data) {
    return (
      <PanelShell onClose={onClose} title="Error">
        <div className="p-4"><div className="banner-error">{error}</div></div>
      </PanelShell>
    );
  }

  if (!data) return null;

  const cap = capRateView(data);
  const followUp = relativeDays(data.nextFollowUpDate);
  const activeOpportunity = data.opportunities.find((o) => o.state === 'active');
  const callContacts = data.contacts.map((c) => ({
    id: c.contact.id, name: c.contact.name,
    relationship: CONTACT_ROLE_LABELS[c.relationship] ?? c.relationship,
    phone: c.contact.phone,
  }));

  const TABS: Array<[Tab, string, number | null]> = [
    ['overview', 'Overview', null],
    ['calls', 'Calls', data.timeline.filter((t) => t.type !== 'status_change' && t.type !== 'system').length],
    ['contacts', 'Contacts', data.contacts.length],
    ['financial', 'Financial', null],
    ['parcels', 'Parcels', data.parcels.length],
  ];

  return (
    <PanelShell
      onClose={onClose}
      title={propertyTitle(data)}
      subtitle={formatAddress(data)}
      badge={data.isSample ? <SampleBadge /> : null}
      headerExtra={
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusChip label={data.outreachStatus?.label} color={data.outreachStatus?.color} />
          <StatusChip
            label={LISTING_STATUS_LABELS[data.listingStatus] ?? data.listingStatus}
            color={data.listingStatus === 'for_sale' ? '#15803d' : '#64748b'}
          />
          {activeOpportunity && (
            <Link href={`/pipeline/${activeOpportunity.id}`}>
              <StatusChip label={`In pipeline: ${activeOpportunity.stageLabel ?? ''}`} color={activeOpportunity.stageColor} />
            </Link>
          )}
          {data.needsParcelOutline && (
            <span className="chip border-amber-300 bg-amber-50 text-amber-800">Needs parcel outline</span>
          )}
          {data.tags.map((t) => <StatusChip key={t.id} label={t.name} color={t.color} />)}
        </div>
      }
      actions={
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={onZoomToProperty} title="Zoom the map to this property">
            <MapPin size={13} /> Zoom
          </button>
          {data.latitude != null && data.longitude != null && (
            <a
              href={streetViewUrl(data.latitude, data.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost btn-sm"
              title="Open Google Street View at this property's coordinates"
            >
              <Camera size={13} /> Street View
            </a>
          )}
          <Link href={`/properties/${data.id}`} className="btn-ghost btn-sm" title="Open the full detail view">
            <ExternalLink size={13} /> Full view
          </Link>
          {isAdmin && (
            <button
              type="button"
              className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
              onClick={() => setConfirmingDelete(true)}
              title="Delete this property"
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      }
    >
      {confirmingDelete && (
        <div className="border-b border-ink-200 bg-red-50 p-3">
          <p className="text-xs text-red-800">
            Delete <span className="font-medium">{propertyTitle(data)}</span>? This removes it (and its
            parcels, contacts, and activity history) from view. This can be undone by an admin, but not from here.
          </p>
          {deleteError && <div className="banner-error mt-2">{deleteError}</div>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => void deleteProperty()}
              disabled={deleting}
            >
              {deleting ? <Spinner /> : <Trash2 size={13} />} Confirm delete
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => { setConfirmingDelete(false); setDeleteError(null); }}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ Tabs */}
      <div className="flex shrink-0 gap-0.5 border-b border-ink-200 px-3">
        {TABS.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${
              tab === key
                ? 'border-accent-600 text-accent-700'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            {label}
            {count !== null && count > 0 && <span className="ml-1 text-ink-400 tnum">{count}</span>}
          </button>
        ))}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {/* -------------------------------------------------------- Overview */}
        {tab === 'overview' && (
          <div className="space-y-4 p-3">
            {followUp && (
              <div className={followUp.days < 0 ? 'banner-error' : followUp.days === 0 ? 'banner-warn' : 'banner-info'}>
                <span>Follow-up {followUp.label} ({formatDate(data.nextFollowUpDate)})</span>
              </div>
            )}

            <CallLogger
              propertyId={data.id}
              contacts={callContacts}
              statuses={statuses}
              currentStatusId={data.outreachStatus?.id ?? null}
              onLogged={() => { void load(); onChanged(); }}
            />

            {!activeOpportunity && (
              <button type="button" className="btn-secondary w-full btn-sm" onClick={() => setPromoting(true)}>
                <TrendingUp size={13} /> Promote to opportunity
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Property type"><Value>{data.propertyType}</Value></Field>
              <Field label="County"><Value>{data.county}</Value></Field>
              <Field label="Land"><Value mono>{formatAcres(data.landAcreage)}</Value></Field>
              <Field label="Building"><Value mono>{formatSqft(data.buildingSqft)}</Value></Field>
              <Field label="Occupancy"><Value mono>{formatPercent(data.occupancyPercent)}</Value></Field>
              <Field label="Owner entity"><Value>{data.ownerEntity?.name}</Value></Field>
            </div>

            {data.tenantInfo && (
              <Field label="Tenants"><p className="whitespace-pre-wrap">{data.tenantInfo}</p></Field>
            )}

            {data.researchNotes && (
              <Field label="Research notes">
                <p className="whitespace-pre-wrap text-ink-700">{data.researchNotes}</p>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3 border-t border-ink-100 pt-3">
              <Field label="First discovered"><Value>{formatDate(data.firstDiscoveredAt)}</Value></Field>
              <Field label="Last verified"><Value>{formatDate(data.lastVerifiedAt)}</Value></Field>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------- Calls */}
        {tab === 'calls' && (
          <div className="p-3">
            <CallLogger
              propertyId={data.id}
              contacts={callContacts}
              statuses={statuses}
              currentStatusId={data.outreachStatus?.id ?? null}
              onLogged={() => { void load(); onChanged(); }}
            />

            <div className="mt-4">
              <SectionHeading>Activity timeline</SectionHeading>
              {data.timeline.length === 0 ? (
                <EmptyState title="No activity yet" body="Logged calls, notes and status changes appear here with who recorded them and when." />
              ) : (
                <ol className="space-y-2.5">
                  {data.timeline.map((t) => (
                    <li key={t.id} className="border-l-2 border-ink-200 pl-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-ink-800">
                          {t.outcome ? CALL_OUTCOME_LABELS[t.outcome] ?? t.outcome : t.subject ?? ACTIVITY_TYPE_LABELS[t.type] ?? t.type}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-400">{formatDateTime(t.occurredAt)}</span>
                      </div>
                      {t.contactName && <div className="text-[11px] text-ink-500">with {t.contactName}</div>}
                      {t.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-700">{t.notes}</p>}
                      {t.sellerMotivation && (
                        <p className="mt-1 text-xs"><span className="font-medium text-ink-600">Motivation:</span> {t.sellerMotivation}</p>
                      )}
                      {t.pricingExpectation && (
                        <p className="text-xs"><span className="font-medium text-ink-600">Pricing:</span> {t.pricingExpectation}</p>
                      )}
                      {t.timingNotes && (
                        <p className="text-xs"><span className="font-medium text-ink-600">Timing:</span> {t.timingNotes}</p>
                      )}
                      <div className="mt-0.5 text-[11px] text-ink-400">{t.authorLabel ?? 'Unknown author'}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- Contacts */}
        {tab === 'contacts' && (
          <div className="space-y-3 p-3">
            {data.ownerEntity && (
              <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5">
                <div className="section-label mb-1">Owner legal entity</div>
                <div className="text-sm font-medium text-ink-900">{data.ownerEntity.name}</div>
                {data.ownerEntity.entityType && <div className="text-xs text-ink-500">{data.ownerEntity.entityType}</div>}
                {data.ownerEntity.mailingAddress && <div className="mt-1 text-xs text-ink-600">{data.ownerEntity.mailingAddress}</div>}
                <p className="field-hint">An entity is not a person. The people who represent it are listed below.</p>
              </div>
            )}

            {data.contacts.length === 0 ? (
              <EmptyState
                title="No contacts yet"
                body="Add the owner, broker or representative so their number is one click away when you call."
              />
            ) : (
              data.contacts.map(({ contact, relationship, isPrimary }) => (
                <div key={`${contact.id}-${relationship}`} className="rounded-md border border-ink-200 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-900">{contact.name}</div>
                      <div className="truncate text-xs text-ink-500">{contact.company ?? UNKNOWN}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isPrimary && <span className="chip border-accent-200 bg-accent-50 text-accent-700">Primary</span>}
                      <StatusChip label={CONTACT_ROLE_LABELS[relationship] ?? relationship} />
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    {contact.phone ? (
                      <div className="flex items-center gap-1.5">
                        <Phone size={12} className="shrink-0 text-ink-400" />
                        <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="flex-1 truncate text-xs text-ink-800 hover:text-accent-700">
                          {contact.phone}
                        </a>
                        <button
                          type="button" className="btn-ghost btn-sm"
                          onClick={() => void copy(contact.phone!, `p-${contact.id}`)}
                          title="Copy phone number"
                        >
                          {copied === `p-${contact.id}` ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Phone size={12} className="shrink-0 text-ink-300" />
                        <span className="unknown">No phone recorded</span>
                      </div>
                    )}

                    {contact.email ? (
                      <div className="flex items-center gap-1.5">
                        <Mail size={12} className="shrink-0 text-ink-400" />
                        <a href={`mailto:${contact.email}`} className="flex-1 truncate text-xs text-ink-800 hover:text-accent-700">
                          {contact.email}
                        </a>
                        <button
                          type="button" className="btn-ghost btn-sm"
                          onClick={() => void copy(contact.email!, `e-${contact.id}`)}
                          title="Copy email address"
                        >
                          {copied === `e-${contact.id}` ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Mail size={12} className="shrink-0 text-ink-300" />
                        <span className="unknown">No email recorded</span>
                      </div>
                    )}
                  </div>

                  {contact.notes && <p className="mt-1.5 text-xs text-ink-600">{contact.notes}</p>}
                  <div className="mt-1 text-[11px] text-ink-400">
                    {contact.source ? `Source: ${contact.source}` : 'Source not recorded'}
                    {contact.verifiedAt ? ` · verified ${formatDate(contact.verifiedAt)}` : ' · not verified'}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ------------------------------------------------------- Financial */}
        {tab === 'financial' && (
          <div className="space-y-4 p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Asking price"><Value mono>{formatMoney(data.askingPrice)}</Value></Field>
              <Field label="Seller indicated"><Value mono>{formatMoney(data.sellerIndicatedPrice)}</Value></Field>
              <Field label="Our target price"><Value mono>{formatMoney(data.targetPurchasePrice)}</Value></Field>
              <Field label="NOI"><Value mono>{formatMoney(data.noi)}</Value></Field>
            </div>

            <div className="rounded-md border border-ink-200 p-2.5">
              <SectionHeading>Cap rate</SectionHeading>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Reported" hint={cap.reportedSource ?? 'No source recorded'}>
                  <Value mono>{formatCapRate(cap.reported)}</Value>
                </Field>
                <Field
                  label="Calculated"
                  hint={cap.calculatedBasis ? `NOI ÷ ${cap.calculatedBasis}` : 'Needs NOI and a price'}
                >
                  <Value mono>{formatCapRate(cap.calculated)}</Value>
                </Field>
              </div>
              {cap.disagrees && (
                <div className="banner-warn mt-2">
                  <span>
                    The reported cap rate differs from the calculated one by more than
                    0.25 points. Reported figures are broker claims, not verified.
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Listing status">
                <Value>{LISTING_STATUS_LABELS[data.listingStatus] ?? data.listingStatus}</Value>
              </Field>
              <Field label="Listing date" hint="Only set when a source states it">
                <Value>{formatDate(data.listingDate)}</Value>
              </Field>
            </div>

            {data.listingSources.length > 0 && (
              <div>
                <SectionHeading>Listing sources</SectionHeading>
                <ul className="space-y-1">
                  {data.listingSources.map((s) => (
                    <li key={s.id}>
                      <a
                        href={s.url} target="_blank" rel="noopener noreferrer nofollow"
                        className="flex items-center gap-1 text-xs text-accent-600 hover:underline"
                      >
                        <ExternalLink size={11} className="shrink-0" />
                        <span className="truncate">{s.sourceName ?? s.url}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* --------------------------------------------------------- Parcels */}
        {tab === 'parcels' && (
          <div className="space-y-3 p-3">
            {data.parcels.length === 0 ? (
              <EmptyState
                icon={<Squircle size={22} />}
                title="No parcels recorded"
                body="This property exists as a map point. Use the Draw parcel tool on the map to outline it, or add a parcel ID from the full detail view."
              />
            ) : (
              <>
                {data.parcels.map((p) => (
                  <div key={p.id} className="rounded-md border border-ink-200 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-900">{p.label ?? 'Parcel'}</span>
                      <span className="text-xs text-ink-500 tnum">{formatAcres(p.acreage)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-600">
                      Parcel ID: <Value>{p.parcelIdText}</Value>
                    </div>
                    {!p.geometry && (
                      <div className="mt-1 text-[11px] text-amber-700">No boundary drawn for this parcel yet.</div>
                    )}
                  </div>
                ))}
                <ApproximateBoundaryNote />
              </>
            )}
          </div>
        )}
      </div>

      {promoting && (
        <PromoteDialog
          propertyId={data.id}
          propertyName={propertyTitle(data)}
          defaultTargetPrice={data.targetPurchasePrice}
          onClose={() => setPromoting(false)}
          onPromoted={() => { setPromoting(false); void load(); onChanged(); }}
        />
      )}
    </PanelShell>
  );
}

function PanelShell({
  title, subtitle, badge, actions, headerExtra, onClose, children,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  headerExtra?: React.ReactNode;
  onClose(): void;
  children: React.ReactNode;
}) {
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-ink-200 bg-white">
      <div className="shrink-0 border-b border-ink-200 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold text-ink-900">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label="Close panel">
            <X size={14} />
          </button>
        </div>
        {headerExtra}
        {actions && <div className="mt-2">{actions}</div>}
      </div>
      {children}
    </aside>
  );
}
