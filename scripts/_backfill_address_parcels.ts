import 'dotenv/config';
import { eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../src/db';
import { markets, properties, propertyParcels } from '../src/db/schema';
import { lookupCountyParcelByAddress } from '../src/lib/geo/county-parcels';
import { attachCountyParcelMatch } from '../src/lib/services/properties';
import type { Actor } from '../src/lib/auth/guards';

const actor: Actor = { id: 'ba342c13-fd7d-40b4-9ca4-84c8e9490cef', name: 'Connor Krosting', email: 'ckrosting@hullpg.com', role: 'admin', label: 'Connor Krosting' } as Actor;

async function main() {
  const marketNames = ['CITRUS', 'LEIGH', 'VIC'];
  const mkts = await db.select().from(markets).where(inArray(markets.name, marketNames));

  let matched = 0;
  let total = 0;

  for (const market of mkts) {
    const props = await db.select({ id: properties.id, name: properties.name, addressLine1: properties.addressLine1 })
      .from(properties)
      .where(eq(properties.marketId, market.id));

    for (const p of props) {
      const existing = await db.select({ id: propertyParcels.id }).from(propertyParcels).where(eq(propertyParcels.propertyId, p.id)).limit(1);
      if (existing.length > 0) continue;
      if (!p.addressLine1) continue;
      total++;

      const match = await lookupCountyParcelByAddress(p.addressLine1, market.name);
      if (match) {
        await attachCountyParcelMatch(p.id, match, actor);
        matched++;
        console.log(`MATCHED [${market.name}] ${p.name} - ${p.addressLine1} -> ${match.parcelId}`);
      } else {
        console.log(`no match [${market.name}] ${p.name} - ${p.addressLine1}`);
      }
    }
  }

  console.log(`\nDone. ${matched}/${total} matched.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
