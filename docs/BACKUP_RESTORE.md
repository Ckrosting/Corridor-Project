# Backup and restore

A backup covers **both** the database rows and the uploaded attachments. A backup
of one without the other is not a backup — a restored database full of attachment
records pointing at files that no longer exist is worse than useless, because it
looks complete.

---

## Why this is not `pg_dump`

The local PostgreSQL used in development ships only `initdb`, `pg_ctl` and
`postgres` — there is no `pg_dump` binary on this machine, and installing the
PostgreSQL client tools needs administrator rights that are not available.

So backup and restore are implemented as a logical dump in TypeScript. The upside
is that the same tool works identically on a laptop and against Railway, is not
tied to a PostgreSQL version, carries the attachment bytes alongside the rows, and
doubles as the local-to-production migration path.

If you later have `pg_dump` available, it remains an excellent *additional*
safety net for production — see "Belt and braces" below.

---

## Taking a backup

```bash
npm run backup
```

Writes to `./backups/<ISO timestamp>/`:

```
backups/2026-09-14T16-26-25-836Z/
├── manifest.json              what was captured, and the migration state
├── tables/
│   ├── properties.ndjson      one JSON object per line
│   ├── activities.ndjson
│   └── … (34 tables)
└── files/
    └── property/<id>/…        the attachment bytes, keyed as stored
```

| Option | Effect |
|---|---|
| `--out ./somewhere` | Write somewhere other than `./backups/<timestamp>` |
| `--no-files` | Rows only; skip attachments |

Tables are streamed with a database cursor, so a large table is never held in
memory. Rows are newline-delimited JSON, so a backup can be inspected, grepped, or
partially recovered with ordinary text tools.

**Read the output.** If an attachment record points at a file the storage driver
cannot produce, the backup does not fail — it copies everything else and prints
`MISSING FILE` for each one, plus a warning at the end. Knowing which files are
already gone is more useful than having no backup at all.

### Backing up production from your machine

```bash
DATABASE_URL='<railway url>' DATABASE_SSL=true \
STORAGE_DRIVER=s3 S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... S3_ENDPOINT=... \
npx tsx scripts/backup.ts --out ./backups/prod-$(date +%F)
```

---

## Restoring

```bash
npm run restore -- --in ./backups/2026-09-14T16-26-25-836Z
```

Restore is deliberately cautious:

| Guard | Behaviour |
|---|---|
| No schema | Refuses, and tells you to run `npm run db:migrate` first |
| Target already has properties | **Refuses**, unless `--truncate` is given |
| `--truncate` | Requires typing `yes`; deletes all existing data first |
| Re-running a restore | Safe — inserts use `on conflict do nothing`, so it is idempotent |

| Option | Effect |
|---|---|
| `--truncate` | Replace existing data (destructive, confirmed) |
| `--no-files` | Rows only |
| `CONFIRM_RESTORE=yes` | Skip the interactive prompt, for scripted use |

Tables are restored in dependency order — parents before children — so foreign
keys are satisfiable as the rows go in.

### Verified

A real round trip was performed during development: a 914-row backup was restored
into a scratch database and compared against the source. Corridor GeoJSON
geometry, the denormalised bbox columns, `numeric` precision, NULL-versus-zero,
timestamps, and many-to-many corridor links were all identical.

---

## Disaster recovery

**Local machine lost or database corrupted**

```bash
npm run db:up
npm run db:migrate
npm run restore -- --in ./backups/<most recent>
```

Keep backups somewhere other than the project folder if you want them to survive
losing the machine. The project folder is OneDrive-synced, which is *some*
protection, but OneDrive is not a backup system — it replicates deletions.

**Production data loss**

1. Railway's PostgreSQL plugin has its own backups; check those first, since a
   point-in-time restore loses less than a nightly logical dump.
2. Otherwise: provision a fresh database, run `npm run release` to build the
   schema, then restore the most recent logical backup.
3. Attachments restore from the same backup directory to whichever bucket the
   `S3_*` variables point at.

**Accidentally deleted records**

Most destructive actions in the application archive rather than delete —
properties, corridors, contacts, statuses, custom fields and attachments all have
an `archived_at` column and keep their history. Check whether the record is merely
archived before reaching for a backup. The `audit_log` table records who changed
what and when, which usually identifies what happened faster than a restore does.

---

## Suggested routine

| When | What |
|---|---|
| Before any risky operation | `npm run backup` — it takes seconds |
| Before a schema migration in production | `npm run backup` |
| Weekly, once real data exists | `npm run backup`, copied off the machine |
| After a large import | `npm run backup`, so there is a known-good point |

Backups are timestamped directories, so they never overwrite each other. They are
also excluded from git by `.gitignore` — they contain real data and must not be
committed.

## Belt and braces

Nothing here prevents you from also using conventional PostgreSQL tooling once
it is available. Railway's own backups plus `pg_dump` give you a
physical-format safety net; this tool gives you a portable, inspectable,
attachment-aware one. Having both is better than choosing.
