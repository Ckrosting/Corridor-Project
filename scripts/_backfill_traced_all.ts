import 'dotenv/config';
import { execSync } from 'child_process';

const markets = ['AUBURN', 'DAYTON', 'GM', 'Statesboro Mall', 'GS', 'SS', 'SUV'];

for (const m of markets) {
  console.log(`\n========== ${m} ==========`);
  try {
    execSync(`npx tsx scripts/_backfill_traced_parcels.ts "${m}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`FAILED for ${m}:`, e);
  }
}
