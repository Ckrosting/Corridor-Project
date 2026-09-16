import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { parseCandidateCsv } from '@/lib/services/candidate-csv';
import { stageCandidates } from '@/lib/services/discovery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Bulk-stages candidates found OUTSIDE the app - e.g. by hand, or by a
 * scheduled research task that does its own web searching - as a free
 * alternative to the Anthropic-API-backed scan.
 *
 * Deliberately calls NO model and records NO ai_usage: this path costs
 * nothing and consumes no budget. Everything still lands in the discovery
 * inbox through the exact same `stageCandidates()` a real scan uses, so
 * dedup, suppression and human review all apply identically - only the
 * research step happened elsewhere.
 */
export const POST = route(async (req: Request) => {
  await requireUser();

  const form = await req.formData();
  const file = form.get('file');
  const corridorId = (form.get('corridorId') as string) || null;
  const marketId = (form.get('marketId') as string) || null;

  if (!(file instanceof File)) throw new AppError(400, 'Choose a CSV file to upload.', 'no_file');
  if (!corridorId && !marketId) throw new AppError(400, 'A corridor or market is required.', 'no_scope');

  const text = await file.text();
  const { candidates, errors } = parseCandidateCsv(text);

  if (candidates.length === 0) {
    return ok({
      staged: { created: 0, updatedExisting: 0, suppressed: 0, duplicates: 0 },
      errors,
      notes: ['No usable rows were found in that file.'],
    });
  }

  const staged = await stageCandidates({ candidates, scanId: null, corridorId, marketId, origin: 'manual_import' });

  return ok({ staged, errors }, 201);
});
