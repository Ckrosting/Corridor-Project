import { requireAdmin } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { createImportBatch, parseImportFile, validateMallRows } from '@/lib/services/import';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Stage 1 of an import: parse, map columns, validate and preview.
 * Nothing is written to the real tables here — that needs an explicit commit.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireAdmin();

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError(400, 'Choose a CSV file to import.', 'no_file');

  const maxBytes = Math.min(env.storage.maxUploadBytes, 15 * 1024 * 1024);
  if (file.size > maxBytes) {
    throw new AppError(413, `That file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 'file_too_large');
  }

  const name = file.name.toLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
    throw new AppError(415, 'Please upload a CSV file. If you have an XLSX, use "Save As → CSV" in Excel first.', 'unsupported_type');
  }

  const text = await file.text();
  const parsed = parseImportFile(text);

  const mappingRaw = form.get('mapping');
  const mapping = typeof mappingRaw === 'string' && mappingRaw
    ? (JSON.parse(mappingRaw) as Record<string, string>)
    : parsed.suggestedMapping;

  const rows = await validateMallRows(parsed, mapping);
  const batch = await createImportBatch(file.name, mapping, rows, actor);

  return ok({
    batch,
    headers: parsed.headers,
    mapping,
    rows: rows.slice(0, 500),
    summary: {
      total: rows.length,
      valid: rows.filter((r) => r.verdict === 'new').length,
      duplicates: rows.filter((r) => r.verdict === 'duplicate').length,
      errors: rows.filter((r) => r.verdict === 'error').length,
    },
  }, 201);
});
