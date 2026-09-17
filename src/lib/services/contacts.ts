import '@/lib/server-guard';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, properties, propertyContacts } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit, updateWithVersion } from './audit';

/**
 * A contact is a person, shared across every property they are linked to - the
 * same broker often represents several listings. Their name, phone, email and
 * so on live once on `contacts`; `property_contacts` holds only what differs per
 * property (their relationship to that specific listing, whether they are the
 * primary contact there). Editing a contact's phone number updates it everywhere
 * they appear; removing them from one property only ever deletes the link, never
 * the person.
 */

export async function createContact(
  input: Record<string, unknown>,
  actor: Actor,
) {
  const [row] = await db.insert(contacts).values({
    ...input,
    createdBy: actor.id,
  } as typeof contacts.$inferInsert).returning();

  await recordAudit({
    entityType: 'contact', entityId: row!.id, action: 'create',
    summary: `Added contact "${row!.name}"`,
    actor,
  });

  return row!;
}

export async function updateContact(
  id: string,
  input: Record<string, unknown> & { version: number; markVerified?: boolean },
  actor: Actor,
) {
  const { version, markVerified, ...patch } = input;

  const values: Record<string, unknown> = { ...patch };
  if (markVerified) values.verifiedAt = new Date();

  const contact = await updateWithVersion<typeof contacts.$inferSelect>({
    table: contacts, id, expectedVersion: version, values, entityLabel: 'contact',
  });

  await recordAudit({
    entityType: 'contact', entityId: id, action: 'update',
    summary: `Updated contact "${contact.name}"`,
    actor,
  });

  return contact;
}

/**
 * Archives a person everywhere at once - they drop out of the contacts list,
 * search and exports. Their property links are deliberately left in place, so
 * every call, activity and audit entry that names them still reads correctly
 * and the person can be restored intact. Removing someone from a single
 * property is a different operation: unlinkContactFromProperty.
 */
export async function archiveContact(id: string, actor: Actor) {
  const [contact] = await db.update(contacts)
    .set({ archivedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  if (!contact) throw new NotFoundError('Contact');

  await recordAudit({
    entityType: 'contact', entityId: id, action: 'archive',
    summary: `Archived contact "${contact.name}"`,
    actor,
  });

  return contact;
}

export async function restoreContact(id: string, version: number, actor: Actor) {
  const contact = await updateWithVersion<typeof contacts.$inferSelect>({
    table: contacts, id, expectedVersion: version, values: { archivedAt: null }, entityLabel: 'contact',
  });

  await recordAudit({
    entityType: 'contact', entityId: id, action: 'restore',
    summary: `Restored contact "${contact.name}"`,
    actor,
  });

  return contact;
}

/**
 * Links a contact to a property - an existing contact by id, or a brand new
 * one described inline, whichever the caller has. Re-linking someone already
 * attached under the same relationship updates that link's isPrimary/notes
 * instead of erroring, since the composite key (property, contact,
 * relationship) makes that a duplicate rather than a distinct row.
 */
export async function linkContactToProperty(input: {
  propertyId: string;
  contactId?: string;
  newContact?: Record<string, unknown>;
  relationship: string;
  isPrimary: boolean;
  notes?: string | null;
  actor: Actor;
}) {
  const { propertyId, relationship, isPrimary, notes, actor } = input;

  const [property] = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!property) throw new NotFoundError('Property');

  let contactId = input.contactId;
  if (!contactId) {
    if (!input.newContact) throw new ValidationError('Provide either an existing contact or details for a new one.');
    const created = await createContact(input.newContact, actor);
    contactId = created.id;
  }

  await db.insert(propertyContacts)
    .values({ propertyId, contactId, relationship: relationship as never, isPrimary, notes: notes ?? null })
    .onConflictDoUpdate({
      target: [propertyContacts.propertyId, propertyContacts.contactId, propertyContacts.relationship],
      set: { isPrimary, notes: notes ?? null },
    });

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);

  await recordAudit({
    entityType: 'property', entityId: propertyId, action: 'link_contact',
    summary: `Linked contact "${contact!.name}" as ${relationship}`,
    actor,
  });

  return contact!;
}

/**
 * Changes a contact's relationship to one property, or just its isPrimary/notes.
 * Relationship is part of the link's primary key, so changing it is a delete
 * of the old row and an insert of the new one rather than a column update.
 */
export async function updatePropertyContactLink(input: {
  propertyId: string;
  contactId: string;
  currentRelationship: string;
  relationship?: string;
  isPrimary?: boolean;
  notes?: string | null;
  actor: Actor;
}) {
  const { propertyId, contactId, currentRelationship, actor } = input;

  const [existing] = await db.select().from(propertyContacts)
    .where(and(
      eq(propertyContacts.propertyId, propertyId),
      eq(propertyContacts.contactId, contactId),
      eq(propertyContacts.relationship, currentRelationship as never),
    )).limit(1);
  if (!existing) throw new NotFoundError('Contact link');

  const relationship = input.relationship ?? currentRelationship;
  const isPrimary = input.isPrimary ?? existing.isPrimary;
  const notes = input.notes !== undefined ? input.notes : existing.notes;

  await db.transaction(async (tx) => {
    if (relationship !== currentRelationship) {
      await tx.delete(propertyContacts).where(and(
        eq(propertyContacts.propertyId, propertyId),
        eq(propertyContacts.contactId, contactId),
        eq(propertyContacts.relationship, currentRelationship as never),
      ));
      await tx.insert(propertyContacts)
        .values({ propertyId, contactId, relationship: relationship as never, isPrimary, notes })
        .onConflictDoUpdate({
          target: [propertyContacts.propertyId, propertyContacts.contactId, propertyContacts.relationship],
          set: { isPrimary, notes },
        });
    } else {
      await tx.update(propertyContacts)
        .set({ isPrimary, notes })
        .where(and(
          eq(propertyContacts.propertyId, propertyId),
          eq(propertyContacts.contactId, contactId),
          eq(propertyContacts.relationship, currentRelationship as never),
        ));
    }
  });

  await recordAudit({
    entityType: 'property', entityId: propertyId, action: 'update_contact_link',
    summary: `Updated a contact's link to this property`,
    actor,
  });
}

/** Removes a contact from a property. The contact itself is untouched. */
export async function unlinkContactFromProperty(input: {
  propertyId: string;
  contactId: string;
  relationship: string;
  actor: Actor;
}) {
  const { propertyId, contactId, relationship, actor } = input;

  const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, contactId)).limit(1);

  const deleted = await db.delete(propertyContacts).where(and(
    eq(propertyContacts.propertyId, propertyId),
    eq(propertyContacts.contactId, contactId),
    eq(propertyContacts.relationship, relationship as never),
  )).returning();

  if (deleted.length === 0) throw new NotFoundError('Contact link');

  await recordAudit({
    entityType: 'property', entityId: propertyId, action: 'unlink_contact',
    summary: `Removed contact "${contact?.name ?? contactId}" from this property`,
    actor,
  });
}
