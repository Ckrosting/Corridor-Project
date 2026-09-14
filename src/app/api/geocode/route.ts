import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { geocode } from '@/lib/geo/geocode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Address lookup. Runs server-side so that no geocoding key is ever present in
 * the browser bundle. Returns an empty result set with an explanation rather than
 * an error, so the UI can fall back to manual map placement.
 */
export const GET = route(async (req: Request) => {
  await requireUser();
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return ok(await geocode(q));
});
