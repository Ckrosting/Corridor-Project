import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, isNull } from 'drizzle-orm';
import { ArrowLeft, ExternalLink, FileText, Paperclip } from 'lucide-react';
import { db } from '@/db';
import { outreachStatuses, tags } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { getPropertyDetail } from '@/lib/services/properties';
import { getPropertyTypes } from '@/lib/services/settings';
import { NotFoundError } from '@/lib/errors';
import {
  ACTIVITY_TYPE_LABELS, CALL_OUTCOME_LABELS, CONTACT_ROLE_LABELS, LISTING_STATUS_LABELS,
  capRateView, formatAcres, formatAddress, formatCapRate, formatDate, formatDateTime,
  formatMoney, formatPercent, formatSqft, propertyTitle, relativeDays,
} from '@/lib/format';
import {
  ApproximateBoundaryNote, EmptyState, Field, SampleBadge, SectionHeading,
  StatusChip, Value,
} from '@/components/ui/primitives';
import { PropertyEditor } from './property-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const p = await getPropertyDetail((await params).id);
    return { title: propertyTitle(p) };
  } catch {
    return { title: 'Property' };
  }
}

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;

  let property: Awaited<ReturnType<typeof getPropertyDetail>>;
  try {
    property = await getPropertyDetail(id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const [statusList, tagList, propertyTypes] = await Promise.all([
    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt)).orderBy(asc(outreachStatuses.sortOrder)),
    db.select().from(tags).where(isNull(tags.archivedAt)).orderBy(asc(tags.name)),
    getPropertyTypes(),
  ]);

  const cap = capRateView(property);
  const followUp = relativeDays(property.nextFollowUpDate);
  const activeOpportunity = property.opportunities.find((o) => o.state === 'active');
  const calls = property.timeline.filter((t) => t.type !== 'status_change');
  const primaryCorridor = property.corridors[0];

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
              <Link href="/properties" className="flex items-center gap-1 hover:text-accent-700">
                <ArrowLeft size={12} /> Properties
              </Link>
              {primaryCorridor && (
                <>
                  <span className="text-ink-300">/</span>
                  <Link href={`/corridors/${primaryCorridor.id}`} className="hover:text-accent-700">
                    {primaryCorridor.name}
                  </Link>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-ink-900">{propertyTitle(property)}</h1>
              {property.isSample && <SampleBadge />}
            </div>
            <p className="text-xs text-ink-500">{formatAddress(property)}</p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusChip label={property.outreachStatus?.label} color={property.outreachStatus?.color} />
              <StatusChip
                label={LISTING_STATUS_LABELS[property.listingStatus] ?? property.listingStatus}
                color={property.listingStatus === 'for_sale' ? '#15803d' : '#64748b'}
              />
              {property.corridors.map((c) => <StatusChip key={c.id} label={c.name} color={c.color} />)}
              {property.tags.map((t) => <StatusChip key={t.id} label={t.name} color={t.color} />)}
              {property.needsParcelOutline && (
                <span className="chip border-amber-300 bg-amber-50 text-amber-800">Needs parcel outline</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            {primaryCorridor && (
              <Link href={`/corridors/${primaryCorridor.id}`} className="btn-secondary btn-sm">
                Open on map <ExternalLink size={12} />
              </Link>
            )}
            {activeOpportunity && (
              <Link href={`/pipeline/${activeOpportunity.id}`} className="btn-secondary btn-sm">
                <StatusChip label={activeOpportunity.stageLabel} color={activeOpportunity.stageColor} />
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 xl:grid-cols-3">

          {/* ------------------------------------------------- Left column */}
          <div className="space-y-5 xl:col-span-2">
            {followUp && (
              <div className={followUp.days < 0 ? 'banner-error' : followUp.days === 0 ? 'banner-warn' : 'banner-info'}>
                <span>Follow-up {followUp.label} ({formatDate(property.nextFollowUpDate)})</span>
              </div>
            )}

            <PropertyEditor
              property={property}
              statuses={statusList.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
              tags={tagList.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
              propertyTypes={propertyTypes}
            />

            {/* ------------------------------------------------ Financial */}
            <section className="card">
              <div className="card-header"><h2 className="card-title">Financial</h2></div>
              <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
                <Field label="Asking price"><Value mono>{formatMoney(property.askingPrice)}</Value></Field>
                <Field label="Seller indicated"><Value mono>{formatMoney(property.sellerIndicatedPrice)}</Value></Field>
                <Field label="Our target"><Value mono>{formatMoney(property.targetPurchasePrice)}</Value></Field>
                <Field label="NOI"><Value mono>{formatMoney(property.noi)}</Value></Field>
              </div>
              <div className="border-t border-ink-100 p-4">
                <SectionHeading>Cap rate</SectionHeading>
                <div className="grid grid-cols-2 gap-4">
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
                      Reported and calculated cap rates disagree by more than 0.25 points.
                      A reported figure is a broker claim, not a verified number.
                    </span>
                  </div>
                )}
              </div>

              {property.priceHistory.length > 0 && (
                <div className="border-t border-ink-100 p-4">
                  <SectionHeading>Price history</SectionHeading>
                  <ul className="space-y-1">
                    {property.priceHistory.map((h) => (
                      <li key={h.id} className="text-xs text-ink-700">
                        <span className="text-ink-500">{formatDate(h.observedAt)}</span>
                        {' — '}{h.field.replace(/_/g, ' ')}:{' '}
                        <span className="tnum">{formatMoney(h.oldValue)}</span>
                        {' → '}
                        <span className="tnum font-medium">{formatMoney(h.newValue)}</span>
                        {h.evidenceNote && <span className="ml-1 text-ink-500">({h.evidenceNote})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* ------------------------------------------------- Timeline */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Calls &amp; activity</h2>
                <span className="text-[11px] text-ink-500">{calls.length} entries</span>
              </div>
              <div className="p-4">
                {property.timeline.length === 0 ? (
                  <EmptyState
                    title="No activity yet"
                    body="Log calls from the corridor map panel, where the owner and broker numbers are one click away."
                  />
                ) : (
                  <ol className="space-y-3">
                    {property.timeline.map((t) => (
                      <li key={t.id} className="border-l-2 border-ink-200 pl-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-ink-800">
                            {t.outcome
                              ? CALL_OUTCOME_LABELS[t.outcome] ?? t.outcome
                              : t.subject ?? ACTIVITY_TYPE_LABELS[t.type] ?? t.type}
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
            </section>
          </div>

          {/* ------------------------------------------------ Right column */}
          <div className="space-y-5">
            {/* ------------------------------------------------- Contacts */}
            <section className="card">
              <div className="card-header"><h2 className="card-title">Contacts</h2></div>
              <div className="space-y-3 p-4">
                {property.ownerEntity && (
                  <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5">
                    <div className="section-label mb-1">Owner legal entity</div>
                    <div className="text-sm font-medium text-ink-900">{property.ownerEntity.name}</div>
                    {property.ownerEntity.entityType && (
                      <div className="text-xs text-ink-500">{property.ownerEntity.entityType}</div>
                    )}
                    {property.ownerEntity.mailingAddress && (
                      <div className="mt-1 text-xs text-ink-600">{property.ownerEntity.mailingAddress}</div>
                    )}
                  </div>
                )}

                {property.contacts.length === 0 ? (
                  <EmptyState title="No contacts" body="Attach the owner or broker so their details travel with this record." />
                ) : (
                  property.contacts.map(({ contact, relationship, isPrimary }) => (
                    <div key={`${contact.id}-${relationship}`} className="rounded-md border border-ink-200 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/contacts/${contact.id}`} className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink-900 hover:text-accent-700">{contact.name}</div>
                          <div className="truncate text-xs text-ink-500">{contact.company ?? '—'}</div>
                        </Link>
                        <div className="flex shrink-0 gap-1">
                          {isPrimary && <span className="chip border-accent-200 bg-accent-50 text-accent-700">Primary</span>}
                          <StatusChip label={CONTACT_ROLE_LABELS[relationship] ?? relationship} />
                        </div>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-xs">
                        <div>Phone: <Value>{contact.phone}</Value></div>
                        <div className="truncate">Email: <Value>{contact.email}</Value></div>
                      </div>
                      <div className="mt-1 text-[11px] text-ink-400">
                        {contact.source ? `Source: ${contact.source}` : 'Source not recorded'}
                        {contact.verifiedAt ? ` · verified ${formatDate(contact.verifiedAt)}` : ' · not verified'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* -------------------------------------------------- Parcels */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Parcels &amp; map</h2>
                <span className="text-[11px] text-ink-500">{property.parcels.length}</span>
              </div>
              <div className="space-y-2 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitude"><Value mono>{property.latitude?.toFixed(6)}</Value></Field>
                  <Field label="Longitude"><Value mono>{property.longitude?.toFixed(6)}</Value></Field>
                </div>
                {property.needsMapPlacement && (
                  <div className="banner-warn"><span>This property has no coordinates and does not appear on the map.</span></div>
                )}

                {property.parcels.length === 0 ? (
                  <p className="text-xs text-ink-500">
                    No parcels recorded. Open the corridor map and use Draw parcel to outline it.
                  </p>
                ) : (
                  property.parcels.map((p) => (
                    <div key={p.id} className="rounded-md border border-ink-200 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ink-900">{p.label ?? 'Parcel'}</span>
                        <span className="text-xs text-ink-500 tnum">{formatAcres(p.acreage)}</span>
                      </div>
                      <div className="text-xs text-ink-600">Parcel ID: <Value>{p.parcelIdText}</Value></div>
                      {!p.geometry && <div className="text-[11px] text-amber-700">No boundary drawn yet.</div>}
                    </div>
                  ))
                )}
                <ApproximateBoundaryNote />
              </div>
            </section>

            {/* -------------------------------------------------- Details */}
            <section className="card">
              <div className="card-header"><h2 className="card-title">Details</h2></div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <Field label="Property type"><Value>{property.propertyType}</Value></Field>
                <Field label="County"><Value>{property.county}</Value></Field>
                <Field label="Land"><Value mono>{formatAcres(property.landAcreage)}</Value></Field>
                <Field label="Building"><Value mono>{formatSqft(property.buildingSqft)}</Value></Field>
                <Field label="Occupancy"><Value mono>{formatPercent(property.occupancyPercent)}</Value></Field>
                <Field label="Year built"><Value mono>{property.yearBuilt}</Value></Field>
                <Field label="Listing date" hint="Only when a source states it">
                  <Value>{formatDate(property.listingDate)}</Value>
                </Field>
                <Field label="First discovered"><Value>{formatDate(property.firstDiscoveredAt)}</Value></Field>
                <Field label="Last verified"><Value>{formatDate(property.lastVerifiedAt)}</Value></Field>
              </div>

              {property.customFields.length > 0 && (
                <div className="border-t border-ink-100 p-4">
                  <SectionHeading>Custom fields</SectionHeading>
                  <div className="grid grid-cols-2 gap-3">
                    {property.customFields.map(({ def, value }) => (
                      <Field key={def.id} label={def.label} hint={def.helpText ?? undefined}>
                        <Value>
                          {value === null || value === undefined
                            ? undefined
                            : def.type === 'checkbox'
                              ? (value ? 'Yes' : 'No')
                              : String(value)}
                        </Value>
                      </Field>
                    ))}
                  </div>
                </div>
              )}

              {property.tenantInfo && (
                <div className="border-t border-ink-100 p-4">
                  <SectionHeading>Tenants</SectionHeading>
                  <p className="whitespace-pre-wrap text-sm text-ink-700">{property.tenantInfo}</p>
                </div>
              )}
            </section>

            {/* ----------------------------------------------- Documents */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title flex items-center gap-1.5"><Paperclip size={14} /> Documents</h2>
              </div>
              <div className="p-4">
                {property.attachments.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={20} />}
                    title="No documents"
                    body="Flyers, offering memoranda, photos and other files attached to this property appear here."
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {property.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/api/attachments/${a.id}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-ink-200 px-2.5 py-2 hover:bg-ink-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-ink-900">{a.filename}</span>
                            <span className="block text-[11px] text-ink-500">
                              {a.kind.replace(/_/g, ' ')} · {(a.sizeBytes / 1024).toFixed(0)} KB · {formatDate(a.createdAt)}
                            </span>
                          </span>
                          <ExternalLink size={13} className="shrink-0 text-ink-400" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* --------------------------------------------- Opportunity */}
            {property.opportunities.length > 0 && (
              <section className="card">
                <div className="card-header"><h2 className="card-title">Related opportunities</h2></div>
                <ul className="divide-y divide-ink-100">
                  {property.opportunities.map((o) => (
                    <li key={o.id} className="p-4">
                      <Link href={`/pipeline/${o.id}`} className="block">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-ink-900 hover:text-accent-700">{o.name}</span>
                          <StatusChip label={o.stageLabel} color={o.stageColor} />
                        </div>
                        <p className="mt-1 text-xs text-ink-600">{o.promotionReason}</p>
                        <p className="mt-0.5 text-[11px] text-ink-400">
                          Promoted {formatDate(o.promotedAt)}
                          {o.state === 'removed' && ' · removed from the active pipeline'}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
