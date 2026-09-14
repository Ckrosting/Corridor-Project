/**
 * Full logical backup: every database row PLUS every stored attachment.
 *
 * Written in TypeScript rather than shelling out to pg_dump because the local
 * PostgreSQL used in development ships only initdb/pg_ctl/postgres — there is no
 * pg_dump binary available. This produces the same backup on a developer laptop
 * and against Railway, and doubles as the local-to-production migration path.
 *
 *   npm run backup                       -> ./backups/<timestamp>/
 *   npm run backup -- --out ./somewhere  -> a directory you choose
 *   npm run backup -- --no-files         -> database rows only
 *
 * The output is newline-delimited JSON per table, so a huge table never has to be
 * held in memory as one array, plus a manifest describing what was captured.
 */
import 'dotenv/config';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

/**
 * Table order matters for restore: parents before children, so foreign keys are
 * satisfiable when the rows are inserted back in this same order.
 */
const TABLES = [
  'users',
  'app_settings',
  'outreach_statuses',
  'transaction_stages',
  'custom_field_defs',
  'tags',
  'markets',
  'mall_anchors',
  'corridors',
  'owner_entities',
  'contacts',
  'properties',
  'property_corridors',
  'property_parcels',
  'property_contacts',
  'property_listing_sources',
  'property_price_history',
  'property_tags',
  'custom_field_values',
  'activities',
  'opportunities',
  'opportunity_properties',
  'opportunity_stage_history',
  'attachments',
  'saved_views',
  'jobs',
  'scans',
  'scan_targets',
  'discovery_results',
  'discovery_suppressions',
  'ai_usage',
  'import_batches',
  'import_rows',
  'audit_log',
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[backup] DATABASE_URL is not set.');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(arg('out') ?? path.join('backups', stamp));
  const includeFiles = !process.argv.includes('--no-files');

  await mkdir(path.join(outDir, 'tables'), { recursive: true });

  const sql = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
  });

  const counts: Record<string, number> = {};

  try {
    console.log(`[backup] Writing to ${outDir}`);

    for (const table of TABLES) {
      const file = path.join(outDir, 'tables', `${table}.ndjson`);
      const stream = createWriteStream(file, { encoding: 'utf8' });
      let rows = 0;

      // Cursor-based streaming so a large table is never fully materialised.
      const cursor = sql`select * from ${sql(table)}`.cursor(500);
      for await (const batch of cursor) {
        for (const row of batch) {
          stream.write(`${JSON.stringify(row)}\n`);
          rows++;
        }
      }

      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      counts[table] = rows;
      console.log(`[backup]   ${table}: ${rows} rows`);
    }

    /* ---------------- Attachments ---------------- */

    let filesCopied = 0;
    let filesMissing = 0;

    if (includeFiles) {
      const attachments = await sql<Array<{ id: string; storage_key: string; filename: string }>>`
        select id, storage_key, filename from attachments where archived_at is null
      `;

      if (attachments.length > 0) {
        await mkdir(path.join(outDir, 'files'), { recursive: true });

        // Imported lazily so a rows-only backup never loads the storage driver.
        const { storage } = await import('../src/lib/storage');
        const driver = storage();

        for (const attachment of attachments) {
          try {
            const bytes = await driver.get(attachment.storage_key);
            const dest = path.join(outDir, 'files', attachment.storage_key);
            await mkdir(path.dirname(dest), { recursive: true });
            await writeFile(dest, bytes);
            filesCopied++;
          } catch (err) {
            // A missing blob is reported loudly rather than failing the whole
            // backup — knowing which files are gone is more useful than no backup.
            filesMissing++;
            console.warn(`[backup]   MISSING FILE for attachment ${attachment.id} (${attachment.filename}): ${attachment.storage_key}`);
          }
        }
        console.log(`[backup]   files: ${filesCopied} copied, ${filesMissing} missing`);
      } else {
        console.log('[backup]   files: none');
      }
    } else {
      console.log('[backup]   files: skipped (--no-files)');
    }

    const [versionRow] = await sql<Array<{ version: string }>>`select version()`;
    const applied = await sql<Array<{ hash: string }>>`
      select hash from drizzle.__drizzle_migrations order by created_at
    `.catch(() => []);

    const manifest = {
      createdAt: new Date().toISOString(),
      databaseVersion: versionRow?.version.split(',')[0] ?? 'unknown',
      // Restoring into a database at a different migration state is the most
      // likely way to corrupt a restore, so the state is recorded here.
      migrationsApplied: applied.length,
      tables: counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
      files: { included: includeFiles, copied: filesCopied, missing: filesMissing },
      note: 'Restore with: npm run restore -- --in <this directory>',
    };

    await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`\n[backup] Done. ${manifest.totalRows} rows across ${TABLES.length} tables.`);
    if (filesMissing > 0) {
      console.log(`[backup] WARNING: ${filesMissing} attachment file(s) could not be read. See the log above.`);
    }
    console.log(`[backup] ${outDir}`);
  } catch (err) {
    console.error('[backup] FAILED:', err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 10 });
  }
}

void main();
