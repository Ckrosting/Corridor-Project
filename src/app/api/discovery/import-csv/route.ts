import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { mallAnchors } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { haversineMeters } from '@/lib/geo/polygon';
import type { Candidate } from '@/lib/ai/extraction';
import { parseCandidateCsv, parseCandidateXlsx } from '@/lib/services/candidate-csv';
import { importCandidatesAsProperties } from '@/lib/services/discovery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const METRES_PER_MILE = 1609.344;

/**
 * Keeps only candidates near the market's mall anchor.
 *
 * A broker export is drawn by city or by county, not by trade area: a Tampa
 * "inventory export" is 411 listings of which a few dozen are anywhere near the
 * mall, and staging all of them buries the inbox. Candidates with no
 * coordinates are KEPT rather than discarded - a listing with a missing lat/lng
 * is not evidence that it is far away - and counted separately so the user can
 * see how much of the import the radius did not actually decide.
 */
async function filterByRadius(candidates: Candidate[], marketId: string, radiusMiles: number): Promise<{
  kept: Candidate[];
  notes: string[];
}> {
  const [anchor] = await db
    .select({ name: mallAnchors.name, latitude: mallAnchors.latitude, longitude: mallAnchors.longitude })
    .from(mallAnchors)
    .where(and(
      eq(mallAnchors.marketId, marketId),
      isNull(mallAnchors.archivedAt),
      isNotNull(mallAnchors.latitude),
      isNotNull(mallAnchors.longitude),
    ))
    .limit(1);

  if (!anchor) {
    return {
      kept: candidates,
      notes: ['This market has no mall anchor with map coordinates, so the distance filter was skipped and every row was imported.'],
    };
  }

  const centre = { lat: anchor.latitude!, lng: anchor.longitude! };
  const limit = radiusMiles * METRES_PER_MILE;

  const kept: Candidate[] = [];
  let outside = 0;
  let noCoordinates = 0;

  for (const candidate of candidates) {
    if (candidate.latitude == null || candidate.longitude == null) {
      noCoordinates++;
      kept.push(candidate);
    } else if (haversineMeters(centre, { lat: candidate.latitude, lng: candidate.longitude }) <= limit) {
      kept.push(candidate);
    } else {
      outside++;
    }
  }

  const notes: string[] = [];
  if (outside > 0) {
    notes.push(`${outside} row${outside === 1 ? ' was' : 's were'} more than ${radiusMiles} miles from ${anchor.name} and were skipped. Re-import with a wider radius to include them.`);
  }
  if (noCoordinates > 0) {
    notes.push(`${noCoordinates} row${noCoordinates === 1 ? ' had' : 's had'} no coordinates, so ${noCoordinates === 1 ? 'it was' : 'they were'} imported without being distance-checked.`);
  }
  return { kept, notes };
}

/**
 * Bulk-stages candidates found OUTSIDE the app - a broker's own inventory
 * export, or a research task that does its own searching - as a free
 * alternative to the Anthropic-API-backed scan.
 *
 * Deliberately calls NO model and records NO ai_usage: this path costs
 * nothing and consumes no budget. Everything still lands in the discovery
 * inbox through the exact same `stageCandidates()` a real scan uses, so
 * dedup, suppression and human review all apply identically - only the
 * research step happened elsewhere.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();

  const form = await req.formData();
  const file = form.get('file');
  const marketId = (form.get('marketId') as string) || null;
  const radiusRaw = (form.get('radiusMiles') as string) || '';
  const radiusMiles = radiusRaw.trim() === '' ? null : Number(radiusRaw);

  if (!(file instanceof File)) throw new AppError(400, 'Choose a spreadsheet to upload.', 'no_file');
  if (!marketId) throw new AppError(400, 'A market is required.', 'no_scope');
  if (radiusMiles !== null && (!Number.isFinite(radiusMiles) || radiusMiles <= 0)) {
    throw new AppError(400, 'The radius must be a positive number of miles, or left empty to import everything.', 'bad_radius');
  }

  const isWorkbook = /\.xls[xm]$/i.test(file.name);
  const parsed = isWorkbook
    ? parseCandidateXlsx(Buffer.from(await file.arrayBuffer()))
    : parseCandidateCsv(await file.text());

  const notes: string[] = [];
  if (parsed.headerRowNumber > 1) {
    notes.push(`Column names were found on row ${parsed.headerRowNumber}; the rows above it were treated as a title or banner.`);
  }

  // Say so when a column was dropped. Mapping is automatic, so an unrecognised
  // header (a CoStar or Crexi export's own naming) silently loses its values -
  // the user would otherwise only find out by spotting a blank price later.
  if (parsed.unmappedHeaders.length > 0) {
    const n = parsed.unmappedHeaders.length;
    notes.push(`${n} ${n === 1 ? 'column was' : 'columns were'} not recognised, so their values were ignored: ${
      parsed.unmappedHeaders.slice(0, 10).join(', ')
    }${n > 10 ? `, and ${n - 10} more` : ''}.`);
  }

  let candidates = parsed.candidates;
  if (candidates.length > 0 && radiusMiles !== null) {
    const filtered = await filterByRadius(candidates, marketId, radiusMiles);
    candidates = filtered.kept;
    notes.push(...filtered.notes);
  }

  if (candidates.length === 0) {
    return ok({
      staged: { created: 0, suppressed: 0, duplicates: 0 },
      errors: parsed.errors,
      notes: ['No usable rows were left to import from that file.', ...notes],
    });
  }

  const staged = await importCandidatesAsProperties({ candidates, marketId, actor });

  if (staged.created > 0) {
    notes.push('Parcel outlines were not looked up during the import - run the parcel backfill to add them.');
  }

  return ok({ staged, errors: parsed.errors, notes }, 201);
});
