import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { attachments } from '@/db/schema';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/services/audit';
import { storage } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Downloads an attachment.
 *
 * Every download goes through this authenticated route rather than a public
 * bucket URL. With the S3 driver it redirects to a short-lived signed URL; with
 * the local driver it streams the bytes. Either way an unauthenticated request
 * gets nothing.
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;

  const [attachment] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!attachment || attachment.archivedAt) throw new NotFoundError('Attachment');

  const driver = storage();
  const signed = await driver.signedUrl(attachment.storageKey, 300);
  if (signed) return Response.redirect(signed, 302);

  const bytes = await driver.get(attachment.storageKey);

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': attachment.contentType,
      // `attachment` rather than `inline`: an uploaded HTML or SVG file rendered
      // inline would execute in the app's own origin.
      'Content-Disposition': `attachment; filename="${attachment.filename.replace(/"/g, '')}"`,
      'Content-Length': String(attachment.sizeBytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** Archives an attachment. The stored bytes are kept so a backup stays complete. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;

  const [attachment] = await db.update(attachments)
    .set({ archivedAt: new Date() })
    .where(eq(attachments.id, id))
    .returning();
  if (!attachment) throw new NotFoundError('Attachment');

  await recordAudit({
    entityType: 'attachment', entityId: id, action: 'archive',
    summary: `Archived attachment "${attachment.filename}"`, actor,
  });

  return ok({ archived: true });
});
