import Link from 'next/link';
import { and, asc, isNull, or, sql as raw } from 'drizzle-orm';
import { Users } from 'lucide-react';
import { db } from '@/db';
import { contacts, ownerEntities } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { CONTACT_ROLE_LABELS, formatDate } from '@/lib/format';
import { EmptyState, StatusChip, Value } from '@/components/ui/primitives';
import { ContactSearch } from './contact-search';

export const metadata = { title: 'Contacts' };
export const dynamic = 'force-dynamic';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim();
  const role = (Array.isArray(sp.role) ? sp.role[0] : sp.role)?.trim();

  const conds = [isNull(contacts.archivedAt)];
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    conds.push(or(
      raw`lower(contacts.name) like ${like}`,
      raw`lower(coalesce(contacts.company, '')) like ${like}`,
      raw`lower(coalesce(contacts.email, '')) like ${like}`,
      raw`coalesce(contacts.phone, '') like ${like}`,
    )!);
  }
  if (role) conds.push(raw`contacts.role::text = ${role}`);

  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      role: contacts.role,
      title: contacts.title,
      phone: contacts.phone,
      email: contacts.email,
      source: contacts.source,
      verifiedAt: contacts.verifiedAt,
      ownerEntityName: ownerEntities.name,
      // One contact can relate to many properties; that link count is the point.
      propertyCount: raw<number>`(select count(*)::int from property_contacts pc
        where pc.contact_id = contacts.id)`,
    })
    .from(contacts)
    .leftJoin(ownerEntities, raw`owner_entities.id = contacts.owner_entity_id`)
    .where(and(...conds))
    .orderBy(asc(raw`lower(contacts.name)`))
    .limit(500);

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Contacts</h1>
          <p className="text-xs text-ink-500">
            {rows.length} reusable contact{rows.length === 1 ? '' : 's'} · one contact can relate to many properties
          </p>
        </div>
        <Link href="/api/export/contacts" className="btn-secondary btn-sm" prefetch={false}>Export CSV</Link>
      </header>

      <ContactSearch />

      <div className="scroll-thin flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users size={26} />}
            title={q ? 'No contacts match' : 'No contacts yet'}
            body={q
              ? 'Try a different name, company, phone number or email.'
              : 'Contacts are created from a property panel when you record who owns or represents a property. They are shared across every property they relate to.'}
          />
        ) : (
          <table className="table-dense">
            <thead>
              <tr>
                <th className="min-w-[200px]">Name</th>
                <th className="w-44">Company</th>
                <th className="w-32">Role</th>
                <th className="w-36">Phone</th>
                <th className="w-52">Email</th>
                <th className="w-24 text-right">Properties</th>
                <th className="w-40">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/contacts/${c.id}`} className="font-medium text-ink-900 hover:text-accent-700">
                      {c.name}
                    </Link>
                    {c.title && <div className="text-[11px] text-ink-500">{c.title}</div>}
                  </td>
                  <td className="text-xs">
                    <Value>{c.company}</Value>
                    {c.ownerEntityName && (
                      <div className="text-[11px] text-ink-500">represents {c.ownerEntityName}</div>
                    )}
                  </td>
                  <td><StatusChip label={CONTACT_ROLE_LABELS[c.role] ?? c.role} /></td>
                  <td className="text-xs tnum">
                    {c.phone
                      ? <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-ink-800 hover:text-accent-700">{c.phone}</a>
                      : <span className="unknown">—</span>}
                  </td>
                  <td className="text-xs">
                    {c.email
                      ? <a href={`mailto:${c.email}`} className="truncate text-ink-800 hover:text-accent-700">{c.email}</a>
                      : <span className="unknown">—</span>}
                  </td>
                  <td className="text-right text-xs tnum text-ink-700">{c.propertyCount}</td>
                  <td className="text-[11px] text-ink-500">
                    <Value>{c.source}</Value>
                    <div>{c.verifiedAt ? `verified ${formatDate(c.verifiedAt)}` : 'not verified'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
