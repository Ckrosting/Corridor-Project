import 'dotenv/config';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../src/db';
import { markets, properties, propertyParcels } from '../src/db/schema';
import { traceParcelFromTiles } from '../src/lib/geo/parcel-trace';
import { attachTracedParcel } from '../src/lib/services/properties';
import type { Actor } from '../src/lib/auth/guards';

const actor: Actor = { id: 'ba342c13-fd7d-40b4-9ca4-84c8e9490cef', name: 'Connor Krosting', email: 'ckrosting@hullpg.com', role: 'admin', label: 'Connor Krosting' } as Actor;

async function main() {
  const marketName = process.argv[2] ?? 'ALTON';
  const dryRun = process.argv.includes('--dry-run');

  const [market] = await db.select().from(markets).where(eq(markets.name, marketName)).limit(1);
  if (!market) { console.error(`No market named "${marketName}"`); process.exit(1); }

  const rows = await db.select({
    id: properties.id, name: properties.name, latitude: properties.latitude, longitude: properties.longitude,
  })
    .from(properties)
    .leftJoin(propertyParcels, eq(propertyParcels.propertyId, properties.id))
    .where(and(eq(properties.marketId, market!.id), isNotNull(properties.latitude), isNull(propertyParcels.id)));

  console.log(`${rows.length} ${marketName} properties with coordinates and no parcel yet.${dryRun ? ' (dry run)' : ''}\n`);

  let traced = 0;
  for (const p of rows) {
    const point = { lat: p.latitude!, lng: p.longitude! };
    const result = await traceParcelFromTiles(point);
    if (!result) {
      console.log(`no trace  [${p.name}]`);
      continue;
    }
    console.log(`TRACED    [${p.name}] ${result.acreage.toFixed(2)} acres`);
    traced++;
    if (!dryRun) {
      await attachTracedParcel(p.id, result, actor);
    }
  }

  console.log(`\nDone. ${traced}/${rows.length} traced${dryRun ? ' (not saved - dry run)' : ' and saved'}.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
