import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { ArrowLeft, Mail, Phone } from 'lucide-react';
import { db } from '@/db';
import { activities, contacts, ownerEntities, properties, propertyContacts } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import {
  ACTIVITY_TYPE_LABELS, CALL_OUTCOME_LABELS, CONTACT_ROLE_LABELS,
  formatAddress, formatDate, formatDateTime, propertyTitle,
} from '@/lib/format';
import { EmptyState, Field, StatusChip, Value } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [c] = await db.select({ name: contacts.name }).from(contacts)
    .where(eq(contacts.id, (await params).id)).limit(1);
  return { title: c?.name ?? 'Contact' };
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;

  const [contact] = await db
    .select({ c: contacts, entityName: ownerEntities.name })
    .from(contacts)
    .leftJoin(ownerEntities, eq(ownerEntities.id, contacts.ownerEntityId))
    .where(eq(contacts.id, id))
    .limit(1);
  if (!contact) notFound();

  // One contact relates to many properties — that relationship is the whole point
  // of a shared contact record rather than a per-property copy.
  const [linked, recentCalls] = await Promise.all([
    db.select({
      id: properties.id, name: properties.name, addressLine1: properties.addressLine1,
      city: properties.city, state: properties.state, postalCode: properties.postalCode,
      relationship: propertyContacts.relationship, isPrimary: propertyContacts.isPrimary,
    })
      .from(propertyContacts)
      .innerJoin(properties, eq(properties.id, propertyContacts.propertyId))
      .where(eq(propertyContacts.contactId, id)),

    db.select({
      id: activities.id, propertyId: activities.propertyId, propertyName: properties.name,
      propertyAddress: properties.addressLine1, type: activities.type, outcome: activities.outcome,
      notes: activities.notes, occurredAt: activities.occurredAt, authorLabel: activities.authorLabel,
    })
      .from(activities)
      .innerJoin(properties, eq(properties.id, activities.propertyId))
      .where(eq(activities.contactId, id))
      .orderBy(desc(activities.occurredAt))
      .limit(30),
  ]);

  const c = contact.c;

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/contacts" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Contacts
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">{c.name}</h1>
          <StatusChip label={CONTACT_ROLE_LABELS[c.role] ?? c.role} />
        </div>
        <p className="text-xs text-ink-500">
          {[c.title, c.company].filter(Boolean).join(' · ') || 'No company recorded'}
        </p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <section className="card">
              <div className="card-header"><h2 className="card-title">Call history with this contact</h2></div>
              {recentCalls.length === 0 ? (
                <EmptyState
                  title="No calls logged"
                  body="Calls recorded against this person on any property will appear here."
                />
              ) : (
                <ol className="divide-y divide-ink-100">
                  {recentCalls.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/properties/${a.propertyId}`}
                          className="truncate text-sm font-medium text-ink-900 hover:text-accent-700"
                        >
                          {propertyTitle({ name: a.propertyName, addressLine1: a.propertyAddress })}
                        </Link>
                        <span className="shrink-0 text-[11px] text-ink-400">{formatDateTime(a.occurredAt)}</span>
                      </div>
                      <div className="text-xs text-ink-600">
                        {a.outcome
                          ? CALL_OUTCOME_LABELS[a.outcome] ?? a.outcome
                          : ACTIVITY_TYPE_LABELS[a.type] ?? a.type}
                      </div>
                      {a.notes && <p className="mt-0.5 text-xs text-ink-700">{a.notes}</p>}
                      <div className="text-[11px] text-ink-400">{a.authorLabel ?? ''}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="space-y-5">
            <section className="card">
              <div className="card-header"><h2 className="card-title">Details</h2></div>
              <div className="space-y-3 p-4">
                <Field label="Phone">
                  {c.phone ? (
                    <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 text-ink-900 hover:text-accent-700">
                      <Phone size={12} /> {c.phone}
                    </a>
                  ) : <Value>{null}</Value>}
                </Field>
                {c.phoneAlt && <Field label="Alternate phone"><Value>{c.phoneAlt}</Value></Field>}
                <Field label="Email">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 break-all text-ink-900 hover:text-accent-700">
                      <Mail size={12} /> {c.email}
                    </a>
                  ) : <Value>{null}</Value>}
                </Field>
                <Field label="Represents entity" hint="An entity is not a person; this links the two.">
                  <Value>{contact.entityName}</Value>
                </Field>
                <Field label="Source"><Value>{c.source}</Value></Field>
                <Field label="Verified">
                  <Value>{c.verifiedAt ? formatDate(c.verifiedAt) : null}</Value>
                </Field>
                {c.notes && (
                  <Field label="Notes"><p className="whitespace-pre-wrap text-ink-700">{c.notes}</p></Field>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Related properties</h2>
                <span className="text-[11px] text-ink-500">{linked.length}</span>
              </div>
              {linked.length === 0 ? (
                <p className="p-4 text-xs text-ink-500">Not linked to any property yet.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {linked.map((p) => (
                    <li key={`${p.id}-${p.relationship}`} className="p-3">
                      <Link href={`/properties/${p.id}`} className="block">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink-900 hover:text-accent-700">
                              {propertyTitle(p)}
                            </span>
                            <span className="block truncate text-[11px] text-ink-500">{formatAddress(p)}</span>
                          </span>
                          <StatusChip label={CONTACT_ROLE_LABELS[p.relationship] ?? p.relationship} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
