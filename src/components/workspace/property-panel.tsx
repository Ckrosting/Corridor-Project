'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Camera, Check, Copy, ExternalLink, Mail, MapPin, Pencil, Phone, Plus, Squircle, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  ACTIVITY_TYPE_LABELS, CALL_OUTCOME_LABELS, CONTACT_ROLE_LABELS, LISTING_STATUS_LABELS,
  capRateView, formatAcres, formatAddress, formatCapRate, formatDate, formatDateTime,
  formatMoney, propertyTitle, relativeDays, UNKNOWN,
} from '@/lib/format';
import {
  ApproximateBoundaryNote, EmptyState, Field, SampleBadge, SectionHeading,
  Spinner, StatusChip, Value,
} from '@/components/ui/primitives';
import { streetViewUrl } from '@/lib/geo/street-view';
import { CallLogger, type OutreachStatusOption } from './call-logger';
import { PromoteDialog } from './promote-dialog';
import { PropertyEditor } from './property-editor';
import { OwnerEntityCard } from './owner-entity-fields';

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
  yearBuilt: number | null;
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
  needsMapPlacement: boolean;
  isSample: boolean;
  version: number;
  outreachStatus: { id: string; label: string; color: string } | null;
  ownerEntity: { id: string; name: string; entityType: string | null; mailingAddress: string | null; notes: string | null; version: number } | null;
  parcels: Array<{ id: string; parcelIdText: string | null; label: string | null; acreage: string | null; geometry: unknown }>;
  contacts: Array<{
    contact: {
      id: string; version: number; name: string; company: string | null; title: string | null;
      phone: string | null; phoneAlt: string | null; email: string | null; notes: string | null;
      verifiedAt: string | null; source: string | null;
    };
    relationship: string;
    isPrimary: boolean;
    linkNotes: string | null;
  }>;
  tags: Array<{ id: string; name: string; color: string }>;
  timeline: Array<{
    id: string; type: string; outcome: string | null; subject: string | null; notes: string | null;
    occurredAt: string; authorLabel: string | null; contactName: string | null;
    sellerMotivation: string | null; pricingExpectation: string | null; timingNotes: string | null;
    editedAt: string | null;
  }>;
  listingSources: Array<{ id: string; url: string; sourceName: string | null }>;
  opportunities: Array<{ id: string; name: string; state: string; stageLabel: string | null; stageColor: string | null; promotedAt: string; promotionReason: string }>;
  customFields: Array<{
    def: { id: string; key: string; label: string; type: string; options: string[] | null; helpText: string | null };
    value: unknown;
  }>;
}

type Tab = 'overview' | 'calls' | 'contacts' | 'financial' | 'parcels';

interface ContactForm {
  name: string;
  company: string;
  title: string;
  phone: string;
  phoneAlt: string;
  email: string;
  notes: string;
  relationship: string;
  isPrimary: boolean;
}

const emptyContactForm = (): ContactForm => ({
  name: '', company: '', title: '', phone: '', phoneAlt: '', email: '', notes: '',
  relationship: 'other', isPrimary: false,
});

/** Empty string means "not set", never the literal value - matches the pattern in property-editor.tsx. */
const blank = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Mirrors the server-side restriction in activities.ts: status_change/system rows are not user edits. */
const EDITABLE_ACTIVITY_TYPES = new Set(['call', 'note', 'email', 'meeting']);

interface ActivityForm {
  occurredAt: string;
  outcome: string;
  notes: string;
  sellerMotivation: string;
  pricingExpectation: string;
  timingNotes: string;
}

const emptyActivityForm = (): ActivityForm => ({
  occurredAt: '', outcome: '', notes: '', sellerMotivation: '', pricingExpectation: '', timingNotes: '',
});

/** `<input type="datetime-local">` wants local wall-clock time, not the UTC an ISO string carries. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The property side panel.
 *
 * Opening it never moves the map — the parent keeps its viewport — so the user
 * does not lose their place while working a market.
 */
export function PropertyPanel({
  propertyId, statuses, tags, propertyTypes, isAdmin, onClose, onChanged, onZoomToProperty, onPlaceOnMap,
}: {
  propertyId: string;
  statuses: OutreachStatusOption[];
  tags: Array<{ id: string; name: string; color: string }>;
  propertyTypes: string[];
  isAdmin: boolean;
  onClose(): void;
  onChanged(): void;
  onZoomToProperty(): void;
  onPlaceOnMap(): void;
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

  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [activityForm, setActivityForm] = useState(emptyActivityForm());
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [confirmingDeleteActivityId, setConfirmingDeleteActivityId] = useState<string | null>(null);

  const [addingContact, setAddingContact] = useState(false);
  const [editingContactKey, setEditingContactKey] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState(emptyContactForm());
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

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

  async function addContact() {
    if (!contactForm.name.trim()) { setContactError('A name is required.'); return; }
    setContactBusy(true);
    setContactError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newContact: {
            name: contactForm.name.trim(),
            company: blank(contactForm.company),
            title: blank(contactForm.title),
            phone: blank(contactForm.phone),
            phoneAlt: blank(contactForm.phoneAlt),
            email: blank(contactForm.email),
            notes: blank(contactForm.notes),
          },
          relationship: contactForm.relationship,
          isPrimary: contactForm.isPrimary,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not add this contact.');
      setAddingContact(false);
      setContactForm(emptyContactForm());
      void load();
      onChanged();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Could not add this contact.');
    } finally {
      setContactBusy(false);
    }
  }

  async function saveContactEdit(current: PropertyDetailData['contacts'][number]) {
    setContactBusy(true);
    setContactError(null);
    try {
      // The person's own details (name, phone, email, ...) are shared across
      // every property they are linked to, so they are one write to the
      // contact record. Their relationship to THIS property - and whether they
      // are its primary contact - is a separate write to the link.
      const contactRes = await fetch(`/api/contacts/${current.contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: current.contact.version,
          name: contactForm.name.trim(),
          company: blank(contactForm.company),
          title: blank(contactForm.title),
          phone: blank(contactForm.phone),
          phoneAlt: blank(contactForm.phoneAlt),
          email: blank(contactForm.email),
          notes: blank(contactForm.notes),
        }),
      });
      const contactBody = (await contactRes.json().catch(() => ({}))) as { error?: string };
      if (!contactRes.ok) throw new Error(contactBody.error ?? 'Could not save this contact.');

      const linkRes = await fetch(
        `/api/properties/${propertyId}/contacts/${current.contact.id}?relationship=${current.relationship}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relationship: contactForm.relationship, isPrimary: contactForm.isPrimary }),
        },
      );
      const linkBody = (await linkRes.json().catch(() => ({}))) as { error?: string };
      if (!linkRes.ok) throw new Error(linkBody.error ?? 'Could not save this contact\'s role on this property.');

      setEditingContactKey(null);
      void load();
      onChanged();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Could not save this contact.');
    } finally {
      setContactBusy(false);
    }
  }

  async function removeContact(contactId: string, relationship: string) {
    setContactBusy(true);
    setContactError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/contacts/${contactId}?relationship=${relationship}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not remove this contact.');
      void load();
      onChanged();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Could not remove this contact.');
    } finally {
      setContactBusy(false);
    }
  }

  function startEditingContact(current: PropertyDetailData['contacts'][number]) {
    setContactError(null);
    setContactForm({
      name: current.contact.name,
      company: current.contact.company ?? '',
      title: current.contact.title ?? '',
      phone: current.contact.phone ?? '',
      phoneAlt: current.contact.phoneAlt ?? '',
      email: current.contact.email ?? '',
      notes: current.contact.notes ?? '',
      relationship: current.relationship,
      isPrimary: current.isPrimary,
    });
    setEditingContactKey(`${current.contact.id}-${current.relationship}`);
  }

  function startEditingActivity(t: PropertyDetailData['timeline'][number]) {
    setActivityError(null);
    setActivityForm({
      occurredAt: toLocalInputValue(t.occurredAt),
      outcome: t.outcome ?? '',
      notes: t.notes ?? '',
      sellerMotivation: t.sellerMotivation ?? '',
      pricingExpectation: t.pricingExpectation ?? '',
      timingNotes: t.timingNotes ?? '',
    });
    setEditingActivityId(t.id);
  }

  async function saveActivityEdit(id: string) {
    setActivityBusy(true);
    setActivityError(null);
    try {
      const res = await fetch(`/api/activities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occurredAt: new Date(activityForm.occurredAt).toISOString(),
          outcome: activityForm.outcome || null,
          notes: blank(activityForm.notes),
          sellerMotivation: blank(activityForm.sellerMotivation),
          pricingExpectation: blank(activityForm.pricingExpectation),
          timingNotes: blank(activityForm.timingNotes),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save this entry.');
      setEditingActivityId(null);
      void load();
      onChanged();
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Could not save this entry.');
    } finally {
      setActivityBusy(false);
    }
  }

  async function removeActivity(id: string) {
    setActivityBusy(true);
    setActivityError(null);
    try {
      const res = await fetch(`/api/activities/${id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not delete this entry.');
      setConfirmingDeleteActivityId(null);
      void load();
      onChanged();
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Could not delete this entry.');
    } finally {
      setActivityBusy(false);
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
          {data.needsMapPlacement && (
            <span className="chip border-amber-300 bg-amber-50 text-amber-800">Needs map placement</span>
          )}
          {data.tags.map((t) => <StatusChip key={t.id} label={t.name} color={t.color} />)}
        </div>
      }
      actions={
        <div className="flex items-center gap-1">
          {data.needsMapPlacement ? (
            <button type="button" className="btn-primary btn-sm" onClick={onPlaceOnMap} title="Click the map to set this property's location">
              <MapPin size={13} /> Place on map
            </button>
          ) : (
            <button type="button" className="btn-ghost btn-sm" onClick={onZoomToProperty} title="Zoom the map to this property">
              <MapPin size={13} /> Zoom
            </button>
          )}
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
            parcels, contacts, and activity history) from view. Nothing is erased: tick
            &ldquo;Show deleted&rdquo; on the Properties page to find it again and restore it.
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

            <Field label="Owner entity"><Value>{data.ownerEntity?.name}</Value></Field>

            <PropertyEditor
              property={data}
              statuses={statuses}
              tags={tags}
              propertyTypes={propertyTypes}
              onSaved={() => { void load(); onChanged(); }}
            />

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
              {activityError && <div className="banner-error mb-2" role="alert">{activityError}</div>}
              {data.timeline.length === 0 ? (
                <EmptyState title="No activity yet" body="Logged calls, notes and status changes appear here with who recorded them and when." />
              ) : (
                <ol className="space-y-2.5">
                  {data.timeline.map((t) => {
                    const editable = EDITABLE_ACTIVITY_TYPES.has(t.type);

                    if (editingActivityId === t.id) {
                      return (
                        <li key={t.id} className="rounded-md border border-accent-300 bg-accent-50/40 p-2.5">
                          <div className="space-y-2">
                            <input
                              type="datetime-local" className="input text-xs"
                              value={activityForm.occurredAt}
                              onChange={(e) => setActivityForm((f) => ({ ...f, occurredAt: e.target.value }))}
                            />
                            {t.type === 'call' && (
                              <select
                                className="input text-xs" value={activityForm.outcome}
                                onChange={(e) => setActivityForm((f) => ({ ...f, outcome: e.target.value }))}
                              >
                                <option value="">No outcome</option>
                                {Object.entries(CALL_OUTCOME_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            )}
                            <textarea
                              className="input text-xs" rows={2} placeholder="Notes"
                              value={activityForm.notes}
                              onChange={(e) => setActivityForm((f) => ({ ...f, notes: e.target.value }))}
                            />
                            <textarea
                              className="input text-xs" rows={2} placeholder="Seller motivation"
                              value={activityForm.sellerMotivation}
                              onChange={(e) => setActivityForm((f) => ({ ...f, sellerMotivation: e.target.value }))}
                            />
                            <textarea
                              className="input text-xs" rows={2} placeholder="Pricing expectation"
                              value={activityForm.pricingExpectation}
                              onChange={(e) => setActivityForm((f) => ({ ...f, pricingExpectation: e.target.value }))}
                            />
                            <input
                              className="input text-xs" placeholder="Timing"
                              value={activityForm.timingNotes}
                              onChange={(e) => setActivityForm((f) => ({ ...f, timingNotes: e.target.value }))}
                            />
                          </div>
                          <div className="mt-2 flex justify-end gap-2">
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingActivityId(null)} disabled={activityBusy}>
                              Cancel
                            </button>
                            <button type="button" className="btn-primary btn-sm" onClick={() => void saveActivityEdit(t.id)} disabled={activityBusy}>
                              {activityBusy && <Spinner />} Save
                            </button>
                          </div>
                        </li>
                      );
                    }

                    return (
                      <li key={t.id} className="border-l-2 border-ink-200 pl-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-ink-800">
                            {t.outcome ? CALL_OUTCOME_LABELS[t.outcome] ?? t.outcome : t.subject ?? ACTIVITY_TYPE_LABELS[t.type] ?? t.type}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-[11px] text-ink-400">{formatDateTime(t.occurredAt)}</span>
                            {editable && (
                              confirmingDeleteActivityId === t.id ? (
                                <>
                                  <button
                                    type="button" className="text-[11px] font-medium text-red-600 hover:underline"
                                    onClick={() => void removeActivity(t.id)} disabled={activityBusy}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button" className="text-[11px] text-ink-500 hover:underline"
                                    onClick={() => setConfirmingDeleteActivityId(null)} disabled={activityBusy}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className="btn-ghost btn-sm" title="Edit this entry" onClick={() => startEditingActivity(t)}>
                                    <Pencil size={11} />
                                  </button>
                                  <button
                                    type="button" className="btn-ghost btn-sm text-red-600 hover:bg-red-50" title="Delete this entry"
                                    onClick={() => setConfirmingDeleteActivityId(t.id)}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </>
                              )
                            )}
                          </span>
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
                        <div className="mt-0.5 text-[11px] text-ink-400">
                          {t.authorLabel ?? 'Unknown author'}{t.editedAt && ` · edited ${formatDateTime(t.editedAt)}`}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- Contacts */}
        {tab === 'contacts' && (
          <div className="space-y-3 p-3">
            {data.ownerEntity ? (
              <OwnerEntityCard entity={data.ownerEntity} onSaved={() => { void load(); onChanged(); }} />
            ) : (
              <p className="field-hint">
                No owner entity linked. Set one in the Overview tab&apos;s property editor.
              </p>
            )}

            {contactError && <div className="banner-error" role="alert">{contactError}</div>}

            {data.contacts.length === 0 && !addingContact && (
              <EmptyState
                title="No contacts yet"
                body="Add the owner, broker or representative so their number is one click away when you call."
              />
            )}

            {data.contacts.map((link) => {
              const { contact, relationship, isPrimary } = link;
              const key = `${contact.id}-${relationship}`;
              if (editingContactKey === key) {
                return (
                  <ContactFormCard
                    key={key}
                    form={contactForm}
                    setForm={setContactForm}
                    busy={contactBusy}
                    onCancel={() => setEditingContactKey(null)}
                    onSave={() => void saveContactEdit(link)}
                    saveLabel="Save contact"
                  />
                );
              }
              return (
                <div key={key} className="rounded-md border border-ink-200 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-900">{contact.name}</div>
                      <div className="truncate text-xs text-ink-500">{contact.company ?? UNKNOWN}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isPrimary && <span className="chip border-accent-200 bg-accent-50 text-accent-700">Primary</span>}
                      <StatusChip label={CONTACT_ROLE_LABELS[relationship] ?? relationship} />
                      <button
                        type="button" className="btn-ghost btn-sm" title="Edit this contact"
                        onClick={() => startEditingContact(link)}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button" className="btn-ghost btn-sm text-red-600 hover:bg-red-50" title="Remove from this property"
                        onClick={() => void removeContact(contact.id, relationship)}
                        disabled={contactBusy}
                      >
                        <Trash2 size={12} />
                      </button>
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
              );
            })}

            {addingContact ? (
              <ContactFormCard
                form={contactForm}
                setForm={setContactForm}
                busy={contactBusy}
                onCancel={() => { setAddingContact(false); setContactForm(emptyContactForm()); setContactError(null); }}
                onSave={() => void addContact()}
                saveLabel="Add contact"
              />
            ) : (
              <button
                type="button" className="btn-secondary w-full btn-sm"
                onClick={() => { setContactForm(emptyContactForm()); setContactError(null); setAddingContact(true); }}
              >
                <Plus size={13} /> Add contact
              </button>
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

/** The same small form for adding a new contact or editing an existing one. */
function ContactFormCard({
  form, setForm, busy, onCancel, onSave, saveLabel,
}: {
  form: ContactForm;
  setForm: React.Dispatch<React.SetStateAction<ContactForm>>;
  busy: boolean;
  onCancel(): void;
  onSave(): void;
  saveLabel: string;
}) {
  const set = <K extends keyof ContactForm>(key: K) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  return (
    <div className="space-y-2 rounded-md border border-accent-300 bg-accent-50/40 p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <input className="input" placeholder="Name *" value={form.name} onChange={set('name')} />
        <input className="input" placeholder="Company" value={form.company} onChange={set('company')} />
        <input className="input" placeholder="Title" value={form.title} onChange={set('title')} />
        <select className="input" value={form.relationship} onChange={set('relationship')}>
          {Object.entries(CONTACT_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input className="input" placeholder="Phone" value={form.phone} onChange={set('phone')} />
        <input className="input" placeholder="Alternate phone" value={form.phoneAlt} onChange={set('phoneAlt')} />
        <input className="input" placeholder="Email" value={form.email} onChange={set('email')} />
        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input type="checkbox" checked={form.isPrimary} onChange={set('isPrimary')} />
          Primary contact for this property
        </label>
      </div>
      <textarea className="input" rows={2} placeholder="Notes" value={form.notes} onChange={set('notes')} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary btn-sm" onClick={onSave} disabled={busy}>
          {busy && <Spinner />} {saveLabel}
        </button>
      </div>
    </div>
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
