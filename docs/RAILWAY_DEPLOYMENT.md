# Railway deployment

**Nothing has been deployed and no paid service has been provisioned.** This
document is the prepared path, not a record of something that has happened. Every
step below is written to be followed when you decide to go ahead.

---

## What you will create

Three services in one Railway project:

| Service | What it is | Start command |
|---|---|---|
| **postgres** | Railway's PostgreSQL plugin | — |
| **web** | This repository | `npm run start` |
| **worker** | The *same* repository, different start command | `npm run worker:start` |

The worker is a separate service on purpose. A discovery scan can run for many
minutes, and running it inside a web request would make it hostage to HTTP
timeouts and to the user's browser staying open. Both services talk to the same
database, and jobs are claimed with `FOR UPDATE SKIP LOCKED`, so they never
collide.

You also need **S3-compatible object storage** for attachments. Railway's
application filesystem is ephemeral — anything written there is lost on the next
deploy — so `STORAGE_DRIVER=local` is rejected at startup in production.
Cloudflare R2 has no egress fees and works with the same driver.

---

## Step 1 — push the repository

```bash
git remote add origin <your-git-remote>
git push -u origin main
```

## Step 2 — create the project and database

1. Railway → **New Project** → **Deploy PostgreSQL**.
2. Note that the plugin exposes `DATABASE_URL` as a reference variable.

## Step 3 — the web service

1. **New** → **GitHub Repo** → this repository.
2. Settings → **Build command**: `npm run build`
3. Settings → **Start command**: `npm run start`
4. Settings → **Pre-deploy command**: `npm run release`

   `npm run release` applies pending migrations. Running it as a pre-deploy step
   means the schema is updated exactly once per deploy, before any new instance
   serves traffic.

5. Settings → **Healthcheck path**: `/api/health`

   That endpoint checks database reachability and reports which integrations are
   configured. It returns `503` when the database is unreachable, so a broken
   deploy fails its health check rather than silently serving errors. It never
   reveals a secret value — only whether each one is present.

6. Variables (see the full list below).

## Step 4 — the worker service

1. **New** → **GitHub Repo** → the *same* repository.
2. Settings → **Build command**: `npm run build`
3. Settings → **Start command**: `npm run worker:start`
4. **No healthcheck path** — the worker serves no HTTP.
5. **No pre-deploy command** — migrations belong to the web service only, so two
   services never race to apply them.
6. Give it the same variables as the web service.

## Step 5 — object storage

Create a bucket (Cloudflare R2, AWS S3, Backblaze B2 or MinIO) and set the `S3_*`
variables on both services. The bucket should **not** be public: attachments are
served through the authenticated `/api/attachments/[id]` route, which redirects
to a short-lived signed URL.

---

## Environment variables

Set these on **both** the web and worker services.

### Required

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — a Railway reference, not a literal |
| `DATABASE_SSL` | `true` |
| `AUTH_SECRET` | 32+ random bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_URL` | `https://<your-service>.up.railway.app` |
| `NODE_ENV` | `production` |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From your storage provider |
| `S3_FORCE_PATH_STYLE` | `true` for R2/MinIO, `false` for AWS S3 |

### Must NOT be set

| Variable | Why |
|---|---|
| `DEV_AUTH_BYPASS` | The development sign-in shortcut. It is computed as `!isProduction && …`, so it is absent from production builds regardless — but do not set it, and `/api/health` and the Settings screen will flag it if it ever appears. |

### Optional

| Variable | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Enables discovery. Everything else works without it. |
| `ANTHROPIC_MODEL` | Defaults to `claude-sonnet-5`. Changing it needs no code change. |
| `AI_MONTHLY_BUDGET_USD` | Spend ceiling. `0` disables scans entirely. |
| `WORKER_CONCURRENCY` | Simultaneous scans across all workers. Start at `2`. |
| `NEXT_PUBLIC_SATELLITE_PROVIDER` + key | Satellite imagery. Note these reach the browser by design. |
| `GEOCODER_PROVIDER`, `GEOCODER_API_KEY` | Address lookup at volume. |
| `NEXT_OUTPUT_STANDALONE` | `true` for a smaller image, if you want it. |

---

## Step 6 — first sign-in

Railway has no interactive shell during deploy, so create the first admin by
running the seed once against the production database **from your machine**:

```bash
DATABASE_URL='<the Railway connection string>' \
DATABASE_SSL=true \
SEED_ADMIN_EMAIL='you@hullpg.com' \
SEED_ADMIN_PASSWORD='a long unique password' \
npx tsx scripts/seed.ts
```

Note the absence of `--demo`: production should not get sample records. This also
inserts the default outreach statuses and transaction stages, which the
application needs before a property can be created.

---

## Moving local data to production

The backup tool is the migration path. It is a logical dump, so it is not tied to
a PostgreSQL version and it carries the attachments too.

```bash
# 1. Back up locally, including attachment bytes.
npm run backup

# 2. Prepare the production schema.
DATABASE_URL='<railway url>' DATABASE_SSL=true npx tsx scripts/migrate.ts

# 3. Restore rows and files into production.
#    Point the storage variables at the production bucket so attachments land there.
DATABASE_URL='<railway url>' DATABASE_SSL=true \
STORAGE_DRIVER=s3 S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... S3_ENDPOINT=... \
npx tsx scripts/restore.ts --in ./backups/<timestamp>
```

The restore **refuses to write into a non-empty database** unless you pass
`--truncate`, which requires typed confirmation. That guard exists precisely so a
migration cannot silently duplicate or destroy production data.

Because the restore preserves primary keys, every exported CSV and every recorded
ID stays valid afterwards.

> Verified locally: a 914-row backup was restored into a scratch database and
> compared field by field — corridor geometry, bbox columns, numeric precision,
> NULL-versus-zero, timestamps and many-to-many corridor links were all identical.
> It has **not** yet been run against Railway.

---

## After deploying — check these

1. `GET /api/health` returns `200` with `"database": "ok"`.
2. The Settings screen shows no configuration **errors**.
3. `STORAGE_DRIVER` reads `s3`, not `local`.
4. The sign-in page shows **no** development sign-in button.
5. The worker service log prints `started · concurrency N` and, if you configured
   a key, `discovery enabled · model …`.
6. Upload a small file to a property and download it again, to confirm the bucket
   credentials and the signed-URL path both work.

---

## Scaling notes

For roughly five users this needs very little. Points worth knowing:

- **The web service can scale horizontally.** Sessions are JWTs, so there is no
  sticky-session requirement.
- **Run only one worker replica to begin with.** More is safe — job claiming is
  concurrency-correct — but each replica multiplies possible API spend, and
  `WORKER_CONCURRENCY` is per-process, not global.
- **Migrations run in the pre-deploy step of the web service only.** Do not add a
  pre-deploy command to the worker, or two services will race.
- **Restarting during a scan is safe.** The worker finishes in-flight jobs on
  `SIGTERM`, and any job whose heartbeat goes stale is reclaimed and retried
  rather than being stuck as "running".

## Cost shape

| Item | Notes |
|---|---|
| Railway web + worker + Postgres | Two small services and a small database |
| Object storage | Cheap; R2 has no egress fees |
| Anthropic API | **Only when someone runs a scan.** Nothing is scheduled, nothing recurs, and the monthly ceiling is enforced before a scan starts and re-checked between corridors. |
