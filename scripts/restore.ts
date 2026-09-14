/**
 * Restores a backup produced by `npm run backup`.
 *
 * This is also the local-to-production migration path: take a backup locally,
 * point DATABASE_URL (and the storage driver) at production, and restore.
 *
 *   npm run restore -- --in ./backups/2026-09-14T12-00-00-000Z
 *   npm run restore -- --in <dir> --truncate   (replace existing rows)
 *   npm run restore -- --in <dir> --no-files   (rows only)
 *
 * Safety: refuses to touch a non-empty database unless --truncate is given, and
 * --truncate always requires an explicit confirmation, because it destroys data.
 */
import 'dotenv/config';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import postgres from 'postgres';

const TABLE_ORDER = [
  'users', 'app_settings', 'outreach_statuses', 'transaction_stages',
  'custom_field_defs', 'tags', 'markets', 'mall_anchors', 'corridors',
  'owner_entities', 'contacts', 'properties', 'property_corridors',
  'property_parcels', 'property_contacts', 'property_listing_sources',
  'property_price_history', 'property_tags', 'custom_field_values', 'activities',
  'opportunities', 'opportunity_properties', 'opportunity_stage_history',
  'attachments', 'saved_views', 'jobs', 'scans', 'scan_targets',
  'discovery_results', 'discovery_suppressions', 'ai_usage', 'import_batches',
  'import_rows', 'audit_log',
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function confirm(question: string): Promise<boolean> {
  if (process.env.CONFIRM_RESTORE === 'yes') return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[restore] DATABASE_URL is not set.');
    process.exit(1);
  }

  const inDir = arg('in');
  if (!inDir) {
    console.error('[restore] Usage: npm run restore -- --in <backup directory>');
    process.exit(1);
  }

  const dir = path.resolve(inDir);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`[restore] No manifest.json in ${dir}. Is that a backup directory?`);
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    createdAt: string; totalRows: number; tables: Record<string, number>;
    files: { copied: number };
  };

  const truncate = process.argv.includes('--truncate');
  const includeFiles = !process.argv.includes('--no-files');

  const redacted = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
  console.log(`[restore] Backup from ${manifest.createdAt}: ${manifest.totalRows} rows, ${manifest.files.copied} files`);
  console.log(`[restore] Target: ${redacted}`);

  const sql = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
  });

  try {
    // Refuse to restore over a schema that does not exist yet.
    const [schemaCheck] = await sql<Array<{ exists: boolean }>>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'properties'
      ) as exists
    `;
    if (!schemaCheck?.exists) {
      console.error('[restore] The target database has no schema. Run `npm run db:migrate` first.');
      process.exit(1);
    }

    const [propertyCount] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from properties
    `;
    const existingRows = propertyCount?.n ?? 0;

    if (existingRows > 0 && !truncate) {
      console.error(
        `\n[restore] REFUSING: the target database already contains ${existingRows} propert${existingRows === 1 ? 'y' : 'ies'}.\n` +
        '[restore] Restoring on top would create duplicates or violate unique constraints.\n' +
        '[restore] To REPLACE the existing data, re-run with --truncate (this deletes it).\n',
      );
      process.exit(1);
    }

    if (truncate) {
      console.log(`\n[restore] --truncate will PERMANENTLY DELETE all existing data in ${redacted}`);
      if (!(await confirm('[restore] Type "yes" to confirm: '))) {
        console.log('[restore] Cancelled. Nothing was changed.');
        process.exit(0);
      }
      // One statement, reverse dependency order handled by CASCADE.
      await sql.unsafe(`truncate table ${TABLE_ORDER.map((t) => `"${t}"`).join(', ')} restart identity cascade`);
      console.log('[restore] Existing data removed.');
    }

    /* ---------------- Rows ---------------- */

    let restored = 0;

    for (const table of TABLE_ORDER) {
      const file = path.join(dir, 'tables', `${table}.ndjson`);
      if (!existsSync(file)) continue;
      if ((await stat(file)).size === 0) continue;

      const reader = readline.createInterface({
        input: createReadStream(file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      let batch: Record<string, unknown>[] = [];
      let tableRows = 0;

      const flush = async () => {
        if (batch.length === 0) return;
        // onConflictDoNothing equivalent: a re-run must not fail on rows that
        // already exist, so a partial restore can simply be repeated.
        await sql`insert into ${sql(table)} ${sql(batch)} on conflict do nothing`;
        tableRows += batch.length;
        batch = [];
      };

      for await (const line of reader) {
        if (!line.trim()) continue;
        batch.push(JSON.parse(line) as Record<string, unknown>);
        if (batch.length >= 250) await flush();
      }
      await flush();

      restored += tableRows;
      if (tableRows > 0) console.log(`[restore]   ${table}: ${tableRows} rows`);
    }

    /* ---------------- Attachments ---------------- */

    let filesRestored = 0;

    if (includeFiles && existsSync(path.join(dir, 'files'))) {
      const { storage } = await import('../src/lib/storage');
      const driver = storage();

      const walk = async (base: string, rel = ''): Promise<string[]> => {
        const entries = await readdir(path.join(base, rel), { withFileTypes: true });
        const out: string[] = [];
        for (const entry of entries) {
          const next = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) out.push(...(await walk(base, next)));
          else out.push(next);
        }
        return out;
      };

      const keys = await walk(path.join(dir, 'files'));
      for (const key of keys) {
        const bytes = await readFile(path.join(dir, 'files', key));
        const [row] = await sql<Array<{ content_type: string }>>`
          select content_type from attachments where storage_key = ${key} limit 1
        `;
        await driver.put(key, bytes, row?.content_type ?? 'application/octet-stream');
        filesRestored++;
      }
      console.log(`[restore]   files: ${filesRestored} restored to the "${driver.name}" storage driver`);
    }

    console.log(`\n[restore] Done. ${restored} rows and ${filesRestored} file(s) restored.`);
    if (restored < manifest.totalRows) {
      console.log(
        `[restore] NOTE: ${manifest.totalRows - restored} row(s) from the backup were skipped, ` +
        'which is expected when they already existed (restores are idempotent).',
      );
    }
  } catch (err) {
    console.error('[restore] FAILED:', err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 10 });
  }
}

void main();
