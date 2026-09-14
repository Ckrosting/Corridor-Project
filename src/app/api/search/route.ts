import { and, eq, isNull, or, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, ownerEntities, properties } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { formatAddress, propertyTitle } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (req: Request) => {
  await requireUser();

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return ok({ hits: [] });

  const like = `%${q.toLowerCase()}%`;

  const [propertyHits, contactHits] = await Promise.all([
    db
      .select({
        id: properties.id,
        name: properties.name,
        addressLine1: properties.addressLine1,
        city: properties.city,
        state: properties.state,
        postalCode: properties.postalCode,
        isSample: properties.isSample,
      })
      .from(properties)
      .where(and(
        isNull(properties.archivedAt),
        or(
          raw`lower(coalesce(${properties.name}, '')) like ${like}`,
          raw`lower(coalesce(${properties.addressLine1}, '')) like ${like}`,
          raw`lower(coalesce(${properties.city}, '')) like ${like}`,
          raw`exists (select 1 from property_parcels pp
                where pp.property_id = properties.id
                  and lower(coalesce(pp.parcel_id_text, '')) like ${like})`,
          raw`exists (select 1 from owner_entities oe
                where oe.id = properties.owner_entity_id
                  and lower(oe.name) like ${like})`,
        ),
      ))
      .limit(12),

    db
      .select({
        id: contacts.id, name: contacts.name, company: contacts.company,
        role: contacts.role, phone: contacts.phone, email: contacts.email,
      })
      .from(contacts)
      .where(and(
        isNull(contacts.archivedAt),
        or(
          raw`lower(contacts.name) like ${like}`,
          raw`lower(coalesce(contacts.company, '')) like ${like}`,
          raw`lower(coalesce(contacts.email, '')) like ${like}`,
          raw`coalesce(contacts.phone, '') like ${like}`,
        ),
      ))
      .limit(8),
  ]);

  return ok({
    hits: [
      ...propertyHits.map((p) => ({
        kind: 'property' as const,
        id: p.id,
        title: `${propertyTitle(p)}${p.isSample ? ' (sample)' : ''}`,
        subtitle: formatAddress(p),
      })),
      ...contactHits.map((c) => ({
        kind: 'contact' as const,
        id: c.id,
        title: c.name,
        subtitle: [c.company, c.phone].filter(Boolean).join(' · ') || null,
      })),
    ],
  });
});
