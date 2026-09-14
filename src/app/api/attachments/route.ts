import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { attachments, properties } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/services/audit';
import {
  assertUploadAllowed, buildStorageKey, checksumOf, storage,
} from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Uploads a flyer, offering memorandum, photo or document against a property.
 *
 * Bytes go to the storage driver; only metadata is stored in the database. The
 * storage key is opaque and generated server-side, so a user-supplied filename
 * can never influence where the file lands.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();

  const form = await req.formData();
  const file = form.get('file');
  const propertyId = form.get('propertyId');
  const kind = (form.get('kind') as string) || 'document';
  const description = (form.get('description') as string) || null;

  if (!(file instanceof File)) throw new AppError(400, 'Choose a file to upload.', 'no_file');
  if (typeof propertyId !== 'string') throw new AppError(400, 'A property is required.', 'no_property');

  const [property] = await db.select({ id: properties.id }).from(properties)
    .where(eq(properties.id, propertyId)).limit(1);
  if (!property) throw new NotFoundError('Property');

  const bytes = Buffer.from(await file.arrayBuffer());
  // Type, extension, magic-number and size checks before anything is written.
  assertUploadAllowed(file.name, file.type || 'application/octet-stream', bytes);

  const checksum = checksumOf(bytes);
  const storageKey = buildStorageKey(`property/${propertyId}`, file.name);

  await storage().put(storageKey, bytes, file.type || 'application/octet-stream');

  const [attachment] = await db.insert(attachments).values({
    propertyId,
    kind: (['flyer', 'offering_memorandum', 'photo', 'document', 'other'].includes(kind)
      ? kind : 'document') as never,
    filename: file.name.slice(0, 240),
    storageKey,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: bytes.length,
    checksum,
    description,
    uploadedBy: actor.id,
    uploadedByLabel: actor.name,
  }).returning();

  await recordAudit({
    entityType: 'attachment', entityId: attachment!.id, action: 'create',
    summary: `Uploaded "${file.name}" to a property`, actor,
  });

  return ok({ attachment }, 201);
});
