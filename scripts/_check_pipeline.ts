import 'dotenv/config';
import { db } from '../src/db';
import { opportunities, transactionStages, properties, opportunityProperties } from '../src/db/schema';
async function main() {
  const opps = await db.select().from(opportunities);
  console.log('all opportunities:', JSON.stringify(opps, null, 2));
  const stages = await db.select().from(transactionStages);
  console.log('stages:', JSON.stringify(stages.map(s => ({id: s.id, key: s.key, label: s.label, isTerminal: s.isTerminal})), null, 2));
  process.exit(0);
}
main();
