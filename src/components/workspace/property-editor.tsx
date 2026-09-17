'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, TriangleAlert, X } from 'lucide-react';
import { LISTING_STATUS_LABELS } from '@/lib/format';
import { Spinner } from '@/components/ui/primitives';
import { OwnerEntityPicker } from './owner-entity-fields';

interface EditableProperty {
  id: string;
  version: number;
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
  nextFollowUpDate: string | null;
  researchNotes: string | null;
  outreachStatus: { id: string; label: string; color: string } | null;
  ownerEntity: { id: string; name: string } | null;
  tags: Array<{ id: string; name: string; color: string }>;
  customFields: Array<{
    def: { id: string; key: string; label: string; type: string; options: string[] | null; helpText: string | null };
    value: unknown;
  }>;
}

/**
 * Inline editor for the whole property record.
 *
 * Saves carry the `version` the form was loaded with. If someone else has saved
 * in the meantime the server rejects the write and this shows the conflict
 * rather than letting one person's work quietly replace another's.
 */
export function PropertyEditor({
  property, statuses, tags, propertyTypes, onSaved,
}: {
  property: EditableProperty;
  statuses: Array<{ id: string; label: string; color: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  propertyTypes: string[];
  /** Called after a successful save, in addition to refreshing the route. A
   *  caller that keeps its own client-fetched copy of the property (the map
   *  panel) needs this to know to re-fetch; a server-rendered page does not. */
  onSaved?(): void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState(() => ({
    name: property.name ?? '',
    addressLine1: property.addressLine1 ?? '',
    city: property.city ?? '',
    state: property.state ?? '',
    postalCode: property.postalCode ?? '',
    county: property.county ?? '',
    latitude: property.latitude?.toString() ?? '',
    longitude: property.longitude?.toString() ?? '',
    propertyType: property.propertyType ?? '',
    landAcreage: property.landAcreage ?? '',
    buildingSqft: property.buildingSqft?.toString() ?? '',
    occupancyPercent: property.occupancyPercent ?? '',
    yearBuilt: property.yearBuilt?.toString() ?? '',
    tenantInfo: property.tenantInfo ?? '',
    askingPrice: property.askingPrice ?? '',
    targetPurchasePrice: property.targetPurchasePrice ?? '',
    sellerIndicatedPrice: property.sellerIndicatedPrice ?? '',
    noi: property.noi ?? '',
    capRateReported: property.capRateReported ?? '',
    capRateReportedSource: property.capRateReportedSource ?? '',
    listingStatus: property.listingStatus,
    listingDate: property.listingDate ?? '',
    nextFollowUpDate: property.nextFollowUpDate ?? '',
    researchNotes: property.researchNotes ?? '',
    outreachStatusId: property.outreachStatus?.id ?? '',
  }));

  const [owner, setOwner] = useState<{ id: string; name: string } | null>(
    property.ownerEntity ? { id: property.ownerEntity.id, name: property.ownerEntity.name } : null,
  );
  const [tagIds, setTagIds] = useState<string[]>(property.tags.map((t) => t.id));
  const [customValues, setCustomValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(property.customFields.map(({ def, value }) => [
      def.key,
      value === null || value === undefined ? '' : String(value),
    ])),
  );

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      // Empty strings become null: an unfilled field is unknown, never zero.
      const blank = (v: string) => (v.trim() === '' ? null : v.trim());

      const res = await fetch(`/api/properties/${property.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: property.version,
          name: blank(form.name),
          addressLine1: blank(form.addressLine1),
          city: blank(form.city),
          state: blank(form.state),
          postalCode: blank(form.postalCode),
          county: blank(form.county),
          latitude: form.latitude.trim() ? Number(form.latitude) : null,
          longitude: form.longitude.trim() ? Number(form.longitude) : null,
          propertyType: blank(form.propertyType),
          landAcreage: blank(form.landAcreage),
          buildingSqft: blank(form.buildingSqft),
          occupancyPercent: blank(form.occupancyPercent),
          yearBuilt: blank(form.yearBuilt),
          tenantInfo: blank(form.tenantInfo),
          askingPrice: blank(form.askingPrice),
          targetPurchasePrice: blank(form.targetPurchasePrice),
          sellerIndicatedPrice: blank(form.sellerIndicatedPrice),
          noi: blank(form.noi),
          capRateReported: blank(form.capRateReported),
          capRateReportedSource: blank(form.capRateReportedSource),
          listingStatus: form.listingStatus,
          listingDate: blank(form.listingDate),
          nextFollowUpDate: blank(form.nextFollowUpDate),
          researchNotes: blank(form.researchNotes),
          outreachStatusId: form.outreachStatusId || null,
          ownerEntityId: owner?.id ?? null,
          tagIds,
          customFields: customValues,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.status === 409) {
        setConflict(true);
        setError(body.error ?? 'Someone else changed this property while you were editing.');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');

      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Overview</h2>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
                <Check size={12} /> Saved
              </span>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit
            </button>
          </div>
        </div>
        <div className="p-4">
          {property.researchNotes ? (
            <p className="whitespace-pre-wrap text-sm text-ink-700">{property.researchNotes}</p>
          ) : (
            <p className="text-xs text-ink-500">
              No research notes yet. Click Edit to record what you know about this property.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Editing property</h2>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(false); setError(null); setConflict(false); }} disabled={busy}>
            <X size={13} /> Cancel
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void save()} disabled={busy}>
            {busy && <Spinner />} Save changes
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {conflict && (
          <div className="banner-error">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>
              <strong>Someone else saved first.</strong> Your changes were not applied,
              so nothing of theirs was lost.{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => router.refresh()}>
                Reload the current version
              </button>{' '}
              and reapply your edits.
            </span>
          </div>
        )}
        {error && !conflict && <div className="banner-error" role="alert">{error}</div>}

        <FieldGrid title="Identification">
          <Input label="Property name" value={form.name} onChange={set('name')} />
          <Select label="Property type" value={form.propertyType} onChange={set('propertyType')}
            options={[{ value: '', label: '— not set —' }, ...propertyTypes.map((t) => ({ value: t, label: t }))]} />
          <Input label="Street address" value={form.addressLine1} onChange={set('addressLine1')} />
          <Input label="City" value={form.city} onChange={set('city')} />
          <Input label="State" value={form.state} onChange={set('state')} maxLength={2} />
          <Input label="ZIP" value={form.postalCode} onChange={set('postalCode')} />
          <Input label="County" value={form.county} onChange={set('county')} />
          <Input label="Latitude" value={form.latitude} onChange={set('latitude')} inputMode="decimal" />
          <Input label="Longitude" value={form.longitude} onChange={set('longitude')} inputMode="decimal" />
          <OwnerEntityPicker value={owner?.id ?? null} label={owner?.name ?? null} onChange={setOwner} />
        </FieldGrid>

        <FieldGrid title="Physical">
          <Input label="Land acreage" value={form.landAcreage} onChange={set('landAcreage')} inputMode="decimal" hint="Leave blank if unknown" />
          <Input label="Building sq ft" value={form.buildingSqft} onChange={set('buildingSqft')} inputMode="numeric" hint="Leave blank if unknown" />
          <Input label="Occupancy %" value={form.occupancyPercent} onChange={set('occupancyPercent')} inputMode="decimal" />
          <Input label="Year built" value={form.yearBuilt} onChange={set('yearBuilt')} inputMode="numeric" />
        </FieldGrid>

        <div>
          <label className="label" htmlFor="tenant">Tenant information</label>
          <textarea id="tenant" className="input" rows={2} value={form.tenantInfo} onChange={set('tenantInfo')} />
        </div>

        <FieldGrid title="Financial">
          <Input label="Asking price" value={form.askingPrice} onChange={set('askingPrice')} inputMode="decimal" hint="Blank means unknown, not zero" />
          <Input label="Seller indicated price" value={form.sellerIndicatedPrice} onChange={set('sellerIndicatedPrice')} inputMode="decimal" />
          <Input label="Our target price" value={form.targetPurchasePrice} onChange={set('targetPurchasePrice')} inputMode="decimal" />
          <Input label="NOI" value={form.noi} onChange={set('noi')} inputMode="decimal" />
          <Input label="Cap rate (reported)" value={form.capRateReported} onChange={set('capRateReported')} inputMode="decimal" hint="As stated by a broker" />
          <Input label="Reported cap rate source" value={form.capRateReportedSource} onChange={set('capRateReportedSource')} />
        </FieldGrid>

        <FieldGrid title="Status">
          <Select label="Listing status" value={form.listingStatus} onChange={set('listingStatus')}
            options={Object.entries(LISTING_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <Input label="Listing date" value={form.listingDate} onChange={set('listingDate')} type="date" hint="Only when a source states it" />
          <Select label="Outreach status" value={form.outreachStatusId} onChange={set('outreachStatusId')}
            options={[{ value: '', label: '— not set —' }, ...statuses.map((s) => ({ value: s.id, label: s.label }))]} />
          <Input label="Next follow-up" value={form.nextFollowUpDate} onChange={set('nextFollowUpDate')} type="date" />
        </FieldGrid>

        {tags.length > 0 && (
          <div>
            <div className="label">Tags</div>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id} type="button"
                    onClick={() => setTagIds((ids) => on ? ids.filter((i) => i !== t.id) : [...ids, t.id])}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                      on ? 'border-accent-600 bg-accent-600 text-white' : 'border-ink-300 bg-white text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    {!on && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />}
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {property.customFields.length > 0 && (
          <FieldGrid title="Custom fields">
            {property.customFields.map(({ def }) => {
              const value = customValues[def.key] ?? '';
              const onChange = (v: string) => setCustomValues((c) => ({ ...c, [def.key]: v }));

              if (def.type === 'select') {
                return (
                  <Select
                    key={def.id} label={def.label} value={value} hint={def.helpText ?? undefined}
                    onChange={(e) => onChange(e.target.value)}
                    options={[{ value: '', label: '— not set —' }, ...(def.options ?? []).map((o) => ({ value: o, label: o }))]}
                  />
                );
              }
              if (def.type === 'checkbox') {
                return (
                  <div key={def.id}>
                    <div className="label">{def.label}</div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={value === 'true'}
                        onChange={(e) => onChange(e.target.checked ? 'true' : '')}
                      />
                      Yes
                    </label>
                    {def.helpText && <p className="field-hint">{def.helpText}</p>}
                  </div>
                );
              }
              return (
                <Input
                  key={def.id} label={def.label} value={value} hint={def.helpText ?? undefined}
                  type={def.type === 'date' ? 'date' : 'text'}
                  inputMode={def.type === 'number' ? 'decimal' : undefined}
                  onChange={(e) => onChange(e.target.value)}
                />
              );
            })}
          </FieldGrid>
        )}

        <div>
          <label className="label" htmlFor="notes">Research notes</label>
          <textarea id="notes" className="input" rows={5} value={form.researchNotes} onChange={set('researchNotes')} />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
        <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy && <Spinner />} Save changes
        </button>
      </div>
    </section>
  );
}

function FieldGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="section-label mb-2">{title}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>
    </div>
  );
}

function Input({
  label, hint, ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `f-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" {...props} />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function Select({
  label, hint, options, ...props
}: {
  label: string; hint?: string; options: Array<{ value: string; label: string }>;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = `f-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" {...props}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
