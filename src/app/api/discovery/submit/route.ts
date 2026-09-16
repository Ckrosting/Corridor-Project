import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { AppError, BudgetError, ConfigurationError } from '@/lib/errors';
import { env } from '@/lib/env';
import { isAiConfigured } from '@/lib/ai/client';
import { researchDocument, researchUrl } from '@/lib/ai/research';
import { monthToDateSpendUsd, recordUsage, stageCandidates } from '@/lib/services/discovery';
import { getSetting, SETTING_KEYS } from '@/lib/services/settings';
import { assertUploadAllowed } from '@/lib/storage';
import { normalizeUrl } from '@/lib/services/dedupe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A single URL or document runs inline rather than through the worker: it is one
// short call, and the user is waiting for the result.
export const maxDuration = 300;

const urlSchema = z.object({
  url: z.string().trim().min(4).max(2000),
  marketId: z.string().uuid().nullish(),
});

async function preflight() {
  if (!isAiConfigured()) {
    throw new ConfigurationError(
      'Extraction needs an API key. An administrator can set ANTHROPIC_API_KEY on the server. You can still add listings by hand.',
    );
  }
  const budget = (await getSetting<number>(SETTING_KEYS.aiMonthlyBudgetUsd)) ?? env.ai.monthlyBudgetUsd;
  const spent = await monthToDateSpendUsd();
  if (budget <= 0 || spent >= budget) {
    throw new BudgetError(
      `The monthly AI budget of $${budget.toFixed(2)} has been reached (about $${spent.toFixed(2)} recorded).`,
      { budget, spent },
    );
  }
  return getSetting<{ inputPerMTok: number; outputPerMTok: number; webSearchPerThousand: number }>(
    SETTING_KEYS.aiCostRates,
  );
}

/**
 * Manual submission: a listing URL or an uploaded flyer/OM.
 *
 * Both go through the SAME extraction and review pipeline as a scan — the result
 * lands in the discovery inbox for a human to approve, never straight into the
 * property table.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const contentType = req.headers.get('content-type') ?? '';

  /* ------------------------------------------------------- Document upload */
  if (contentType.includes('multipart/form-data')) {
    const rates = await preflight();
    const form = await req.formData();
    const file = form.get('file');
    const marketId = (form.get('marketId') as string) || null;

    if (!(file instanceof File)) throw new AppError(400, 'Choose a flyer or offering memorandum to upload.', 'no_file');

    const bytes = Buffer.from(await file.arrayBuffer());
    assertUploadAllowed(file.name, file.type || 'application/octet-stream', bytes);

    const isReadable = file.type === 'application/pdf' || file.type.startsWith('image/');
    if (!isReadable) {
      throw new AppError(
        415,
        'Only PDF and image files can be read for extraction. For a Word or Excel file, export it to PDF first.',
        'unsupported_for_extraction',
      );
    }

    const outcome = await researchDocument(
      { filename: file.name, contentType: file.type, bytes },
      rates,
    );

    await recordUsage({
      scanId: null, model: env.ai.model, operation: 'document_extract',
      inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
      webSearches: 0, estimatedCostUsd: outcome.usage.estimatedCostUsd,
    });

    const staged = await stageCandidates({
      candidates: outcome.result.candidates,
      scanId: null, marketId, origin: 'manual_document',
    });

    return ok({ staged, notes: [...outcome.result.coverageNotes, ...outcome.notes] }, 201);
  }

  /* ------------------------------------------------------------- URL */
  const input = urlSchema.parse(await readJson(req));
  const normalized = normalizeUrl(input.url);
  if (!normalized) {
    throw new AppError(400, 'That does not look like a valid http or https URL.', 'bad_url');
  }

  const rates = await preflight();
  const outcome = await researchUrl(normalized, rates);

  await recordUsage({
    scanId: null, model: env.ai.model, operation: 'url_extract',
    inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
    webSearches: outcome.usage.webSearches, estimatedCostUsd: outcome.usage.estimatedCostUsd,
  });

  const staged = await stageCandidates({
    candidates: outcome.result.candidates,
    scanId: null,
    marketId: input.marketId ?? null,
    origin: 'manual_url',
  });

  void actor;
  return ok({ staged, notes: [...outcome.result.coverageNotes, ...outcome.notes] }, 201);
});
