import 'dotenv/config';
import { and, eq, isNull, isNotNull, ne } from 'drizzle-orm';
import { db } from '../src/db';
import { properties } from '../src/db/schema';
import { geocode } from '../src/lib/geo/geocode';
import { updateProperty } from '../src/lib/services/properties';
import type { Actor } from '../src/lib/auth/guards';

const actor: Actor = { id: 'ba342c13-fd7d-40b4-9ca4-84c8e9490cef', name: 'Connor Krosting', email: 'ckrosting@hullpg.com', role: 'admin', label: 'Connor Krosting' } as Actor;

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const dryRun = process.argv.includes('--dry-run');
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  let rows = await db.select({
    id: properties.id, version: properties.version, name: properties.name,
    addressLine1: properties.addressLine1, city: properties.city, state: properties.state, postalCode: properties.postalCode,
  })
    .from(properties)
    .where(and(isNull(properties.latitude), isNotNull(properties.addressLine1), ne(properties.addressLine1, '')));

  if (limit) rows = rows.slice(0, limit);
  console.log(`${rows.length} properties to geocode.${dryRun ? ' (dry run - no writes)' : ''}\n`);

  let geocoded = 0;
  let skipped = 0;

  for (const p of rows) {
    const parts = [p.addressLine1, p.city, p.state, p.postalCode].filter(Boolean);
    const query = parts.join(', ');
    const outcome = await geocode(query, 1);

    const hit = outcome.results[0];
    if (!hit) {
      console.log(`no match  [${p.name}] ${query}`);
      skipped++;
      continue;
    }

    if (!dryRun) {
      await updateProperty(p.id, {
        version: p.version,
        latitude: hit.lat,
        longitude: hit.lng,
        locationSource: `geocoded:${hit.provider}`,
      }, actor);
    }
    geocoded++;
    console.log(`geocoded  [${p.name}] ${query} -> ${hit.lat.toFixed(5)},${hit.lng.toFixed(5)} (${hit.confidence})`);
  }

  console.log(`\nDone. ${geocoded}/${rows.length} geocoded, ${skipped} no match.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
